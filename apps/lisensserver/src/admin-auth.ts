/**
 * Tilgangssjekken for admin-endepunktene.
 *
 * Løser opp én av tre måter å være innlogget på, i denne rekkefølgen:
 *
 *   1. Øktkapsel        — et menneske i panelet
 *   2. Maskintoken      — et skript, med egen identitet og rolle
 *   3. Nødinngang       — ADMIN_TOKEN, midlertidig (se under)
 *
 * Selve regelverket ligger i tilgang.ts og er testet uten database.
 * Denne modulen gjør bare oppslaget og håndhever totrinnskravet.
 *
 * MIDLERTIDIG: ADMIN_TOKEN godtas fortsatt som bærertoken, slik at
 * røyktestskriptene virker mens A1 rulles ut. Det fjernes i A3, når
 * navngitte maskintokens er på plass — da er ADMIN_TOKEN bare
 * nødinngang, og den veksles inn i en 60-minutters økt gjennom
 * /api/v1/admin/auth/nodinngang framfor å virke ved hvert kall.
 */

import { hashAdminSecret } from "@ordlyd/license-core";
import {
  bearerToken, secretEquals, requireEnv, unauthorized, forbidden,
  getSql, getPepper, type HttpResponse,
} from "./runtime.js";
import { finnLevendeOkt, fornyOkt, finnApiToken } from "./admin-identitet.js";
import { lesKapsler, OKT_KAPSEL, OKT_LEVETID_SEK, OKT_MAKS_ALDER_SEK } from "./okt.js";
import { krevesTotrinn, omfangErGyldig, type Innlogget } from "./tilgang.js";
import type { DecodedRequest } from "./http.js";

export type Tilgang = { meg: Innlogget } | { svar: HttpResponse };

export const erNektet = (t: Tilgang): t is { svar: HttpResponse } => "svar" in t;

/**
 * Kreves på alle tilstandsendrende admin-kall. En fremmed nettside kan
 * ikke sette egendefinerte hoder uten CORS-tillatelse, og admin-
 * endepunktene gir ingen. Sammen med SameSite=Strict er dette to
 * uavhengige lag mot forespørselsforfalskning.
 */
export const PANELHODE = "x-ordlyd-panel";

export async function loesInnlogget(req: DecodedRequest): Promise<Tilgang> {
  const pepper = getPepper();
  const sql = getSql();

  /* --- 1. Øktkapsel --- */
  const kapsler = lesKapsler(req.headers.cookie);
  const oktToken = kapsler[OKT_KAPSEL];
  if (oktToken) {
    const hash = await hashAdminSecret(pepper, "okt", oktToken);
    const funn = await finnLevendeOkt(sql, hash);
    if (!funn) return { svar: unauthorized() };

    const { okt, admin } = funn;

    // Totrinnskravet håndheves ved HVER forespørsel, ikke bare ved
    // innlogging. Skrur eier på kravet for en revisorkonto, mister en
    // aal1-økt tilgangen med det samme.
    if (krevesTotrinn(admin.rolle, admin.krevTotrinn) && okt.aal !== "aal2") {
      return { svar: forbidden("krever-totrinn") };
    }

    // En konto der rolle og omfang er blitt ugyldige — typisk etter en
    // manuell SQL-endring — avvises framfor å få for mye.
    const kunder = admin.rolle === "eier" || admin.rolle === "forvalter" ? null : admin.kunder;
    if (!omfangErGyldig(admin.rolle, kunder)) return { svar: forbidden("ugyldig-omfang") };

    await fornyOkt(sql, okt.id, OKT_LEVETID_SEK, OKT_MAKS_ALDER_SEK);

    return {
      meg: {
        adminId: admin.id,
        navn: admin.navn,
        epost: admin.epost,
        rolle: admin.rolle,
        kunder,
        kilde: "okt",
      },
    };
  }

  /* --- 2 og 3. Bærertoken --- */
  const token = bearerToken(req.headers);
  if (!token) return { svar: unauthorized() };

  const apiHash = await hashAdminSecret(pepper, "apitoken", token);
  const maskin = await finnApiToken(sql, apiHash);
  if (maskin) {
    return {
      meg: {
        adminId: maskin.id,
        navn: maskin.navn,
        epost: `maskin:${maskin.navn}`,
        rolle: maskin.rolle,
        kunder: null,
        kilde: "apitoken",
      },
    };
  }

  if (secretEquals(token, requireEnv("ADMIN_TOKEN"))) {
    return {
      meg: {
        adminId: "00000000-0000-0000-0000-000000000000",
        navn: "Nødinngang",
        epost: "nodinngang",
        rolle: "eier",
        kunder: null,
        kilde: "bootstrap",
      },
    };
  }

  return { svar: unauthorized() };
}

/**
 * Vakt mot forespørselsforfalskning for tilstandsendrende kall fra
 * panelet. Maskintokens og nødinngangen slipper — de kommer fra skript
 * uten nettleser, der hverken kapsler eller CORS er i bildet.
 */
export function krevPanelhode(req: DecodedRequest, meg: Innlogget): HttpResponse | null {
  if (meg.kilde !== "okt") return null;
  const verdi = req.headers[PANELHODE];
  const har = Array.isArray(verdi) ? verdi.length > 0 : Boolean(verdi);
  return har ? null : forbidden("mangler-panelhode");
}

/** Hvordan handlingen skal føres i revisjonsloggen. */
export function somAktor(meg: Innlogget): {
  actor: string;
  actorId: string | null;
  actorKind: "admin" | "apitoken" | "bootstrap";
} {
  if (meg.kilde === "bootstrap") {
    return { actor: "nødinngang", actorId: null, actorKind: "bootstrap" };
  }
  if (meg.kilde === "apitoken") {
    return { actor: `maskin: ${meg.navn}`, actorId: null, actorKind: "apitoken" };
  }
  return { actor: `${meg.navn} <${meg.epost}>`, actorId: meg.adminId, actorKind: "admin" };
}
