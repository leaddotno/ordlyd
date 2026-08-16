/**
 * POST /api/v1/admin/auth/totp — andre steg: engangskoden.
 *
 * Tar imot enten en sekssifret kode fra authenticator-appen, eller en
 * reservekode for den som har mistet telefonen. Begge fører til samme
 * sted: en økt på nivå aal2.
 *
 * Reservekoden regnes som likeverdig med engangskoden, ikke svakere.
 * Den er 16 tegn fra et alfabet på 31, altså rundt 79 bits — langt mer
 * enn de seks sifrene den erstatter. Det som gjør den trygg er at den
 * er engangs, og at den bare kan brukes ETTER at passordet er godtatt.
 */

import { hashAdminSecret } from "@ordlyd/license-core";
import { vercelHandler, requireString } from "../../../../src/http.js";
import {
  ok, badRequest, unauthorized, tooManyRequests, newId, nowSec,
  getDb, getSql, getPepper,
} from "../../../../src/runtime.js";
import {
  finnAdmin, opprettOkt, merkInnlogging, brukReservekode, ubrukteReservekoder,
  lagreReservekoder,
} from "../../../../src/admin-identitet.js";
import { bekreftTotp, utfordreTotp, startTotp, AuthFeil } from "../../../../src/supabase-auth.js";
import {
  lesKapsler, aapne, forsegle, nyHemmelighet, settKapsel, slettKapsel,
  normaliserReservekode, lagReservekoder,
  OKT_KAPSEL, TOTRINN_KAPSEL, OKT_LEVETID_SEK, TOTRINN_LEVETID_SEK,
} from "../../../../src/okt.js";

const VINDU_SEK = 15 * 60;
const MAKS_FORSOK = 6;

export default vercelHandler("POST", async (req) => {
  const pepper = getPepper();
  const naa = nowSec();

  const segl = lesKapsler(req.headers.cookie)[TOTRINN_KAPSEL];
  const steg = segl ? aapne(pepper, segl, naa) : null;
  if (!steg) {
    return {
      status: 401,
      body: { feil: "innloggingen-er-utlopt" },
      cookies: [slettKapsel(TOTRINN_KAPSEL)],
    };
  }

  const db = getDb();
  const sql = getSql();
  const handling = requireString(req.body, "handling") ?? "bekreft";

  /*
   * Førstegangs oppsett skjer FØR det finnes en økt: kontoen er ny og
   * har ingen faktor ennå, så den kan ikke gå gjennom /auth/konto som
   * krever innlogging. Den forseglede kapselen fra passordsteget er det
   * eneste beviset vi har på hvem dette er — og det er nok, fordi
   * passordet allerede er godtatt for å få den.
   */
  if (handling === "oppsett-start") {
    const admin0 = await finnAdmin(sql, steg.adminId);
    if (!admin0 || admin0.status !== "aktiv") return unauthorized();
    if (steg.faktorId) return badRequest("totrinn er allerede satt opp");

    const p = await startTotp(steg.accessToken, `Ordlyd panel — ${admin0.navn}`);
    const nyttSegl = forsegle(pepper, { ...steg, faktorId: p.faktorId });
    return {
      status: 200,
      body: { qrSvg: p.qrSvg, qrBilde: p.qrBilde, hemmelighet: p.hemmelighet, uri: p.uri },
      cookies: [settKapsel(TOTRINN_KAPSEL, nyttSegl, TOTRINN_LEVETID_SEK)],
    };
  }

  const kode = requireString(req.body, "kode");
  if (!kode) return badRequest("kode er påkrevd");

  if (handling === "oppsett-fullfor") {
    const admin0 = await finnAdmin(sql, steg.adminId);
    if (!admin0 || admin0.status !== "aktiv") return unauthorized();
    if (!steg.faktorId) return badRequest("start oppsettet først");

    try {
      const utfordring = await utfordreTotp(steg.accessToken, steg.faktorId);
      await bekreftTotp(steg.accessToken, steg.faktorId, utfordring, kode.trim());
    } catch (err) {
      if (err instanceof AuthFeil) {
        return badRequest("Koden stemmer ikke. Prøv den neste appen viser.");
      }
      throw err;
    }

    // Reservekodene lages først når faktoren faktisk virker.
    const koder = lagReservekoder();
    await lagreReservekoder(
      sql, admin0.id,
      await Promise.all(koder.map((k) => hashAdminSecret(pepper, "recovery", k))),
    );

    const token0 = nyHemmelighet();
    await opprettOkt(sql, {
      id: newId(), adminId: admin0.id,
      tokenHash: await hashAdminSecret(pepper, "okt", token0),
      aal: "aal2", levetidSek: OKT_LEVETID_SEK, netHash: null, land: null,
    });
    await merkInnlogging(sql, admin0.id);
    await db.audit(`${admin0.navn} <${admin0.epost}>`, "totrinn-aktivert", { forstegang: true }, {
      actorId: admin0.id, actorKind: "admin", tenantId: null,
    });

    return {
      status: 200,
      body: {
        trinn: "innlogget",
        navn: admin0.navn,
        rolle: admin0.rolle,
        // Eneste gang kodene finnes i klartekst. Serveren har bare hasher.
        reservekoder: koder,
      },
      cookies: [settKapsel(OKT_KAPSEL, token0, OKT_LEVETID_SEK), slettKapsel(TOTRINN_KAPSEL)],
    };
  }

  // Egen teller for dette steget: passordet er alt godtatt, så uten den
  // ville seks siffer kunne gjettes så lenge kapselen lever.
  const nokkel = `admintotp:${steg.adminId}`;
  if ((await db.countAttempts(nokkel, naa - VINDU_SEK)) >= MAKS_FORSOK) return tooManyRequests();
  await db.recordAttempt(nokkel, naa);

  const admin = await finnAdmin(sql, steg.adminId);
  if (!admin || admin.status !== "aktiv") return unauthorized();

  let medReservekode = false;

  // En sekssifret kode er alltid engangskoden fra appen. Alt annet
  // prøves som reservekode.
  if (/^\d{6}$/.test(kode.trim())) {
    if (!steg.faktorId) return badRequest("totrinn er ikke satt opp for denne kontoen");
    try {
      await bekreftTotp(steg.accessToken, steg.faktorId, steg.utfordringId, kode.trim());
    } catch (err) {
      if (err instanceof AuthFeil) {
        await db.audit(`${admin.navn} <${admin.epost}>`, "admin-innlogging-feilet", {
          trinn: "totrinn",
        }, { actorId: admin.id, actorKind: "admin" });
        return unauthorized();
      }
      throw err;
    }
  } else {
    const kodeHash = await hashAdminSecret(pepper, "recovery", normaliserReservekode(kode));
    medReservekode = await brukReservekode(sql, admin.id, kodeHash);
    if (!medReservekode) {
      await db.audit(`${admin.navn} <${admin.epost}>`, "admin-innlogging-feilet", {
        trinn: "reservekode",
      }, { actorId: admin.id, actorKind: "admin" });
      return unauthorized();
    }
  }

  const token = nyHemmelighet();
  await opprettOkt(sql, {
    id: newId(),
    adminId: admin.id,
    tokenHash: await hashAdminSecret(pepper, "okt", token),
    aal: "aal2",
    levetidSek: OKT_LEVETID_SEK,
    netHash: null,
    land: null,
  });
  await merkInnlogging(sql, admin.id);
  await db.clearAttempts(nokkel);

  const igjen = medReservekode ? await ubrukteReservekoder(sql, admin.id) : null;
  await db.audit(`${admin.navn} <${admin.epost}>`, "admin-innlogging", {
    totrinn: true,
    reservekode: medReservekode,
    ...(igjen === null ? {} : { reservekoder_igjen: igjen }),
  }, { actorId: admin.id, actorKind: "admin" });

  return {
    status: 200,
    body: {
      trinn: "innlogget",
      navn: admin.navn,
      rolle: admin.rolle,
      medReservekode,
      // Panelet skal mase om nye koder når det begynner å bli tynt.
      reservekoderIgjen: igjen,
    },
    cookies: [settKapsel(OKT_KAPSEL, token, OKT_LEVETID_SEK), slettKapsel(TOTRINN_KAPSEL)],
  };
}, { cors: false });
