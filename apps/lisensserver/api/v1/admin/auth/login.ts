/**
 * POST /api/v1/admin/auth/login — første steg: e-post og passord.
 *
 * Svarer med ett av tre:
 *
 *   {trinn: "innlogget"}    — revisor uten totrinnskrav, økten er satt
 *   {trinn: "totrinn"}      — tast engangskoden fra authenticator-appen
 *   {trinn: "totrinn-oppsett"} — kontoen mangler totrinn og må sette det opp
 *
 * De to siste setter en kortlivet, kryptert kapsel som bærer
 * Supabase-tokenet mellom stegene. Se okt.ts for hvorfor det ligger i en
 * kapsel og ikke i databasen.
 *
 * Feil e-post, feil passord og ukjent konto gir NØYAKTIG samme svar.
 * Ellers ville endepunktet vært en måte å finne ut hvem som er
 * administrator på.
 */

import { hashAdminSecret, hashNet } from "@ordlyd/license-core";
import { vercelHandler, requireString } from "../../../../src/http.js";
import {
  ok, badRequest, unauthorized, tooManyRequests, newId, nowSec,
  getDb, getSql, getPepper,
} from "../../../../src/runtime.js";
import { finnAdminPaaEpost, opprettOkt, merkInnlogging } from "../../../../src/admin-identitet.js";
import { loggInnMedPassord, utfordreTotp, AuthFeil } from "../../../../src/supabase-auth.js";
import {
  nyHemmelighet, forsegle, settKapsel,
  OKT_KAPSEL, TOTRINN_KAPSEL, OKT_LEVETID_SEK, TOTRINN_LEVETID_SEK,
} from "../../../../src/okt.js";
import { krevesTotrinn } from "../../../../src/tilgang.js";

/** Samme svar uansett hva som var galt. */
const AVVIST = unauthorized();

const VINDU_SEK = 15 * 60;
const MAKS_PER_EPOST = 5;
const MAKS_PER_NETT = 20;

export default vercelHandler("POST", async (req) => {
  const epost = requireString(req.body, "epost")?.trim().toLowerCase();
  const passord = requireString(req.body, "passord");
  if (!epost || !passord) return badRequest("epost og passord er påkrevd");

  const pepper = getPepper();
  const db = getDb();
  const sql = getSql();
  const naa = nowSec();
  const siden = naa - VINDU_SEK;

  // Ratebegrensning FØR legitimasjonen sjekkes, slik at et tregt
  // passordoppslag ikke kan brukes til å måle om kontoen finnes.
  const netHash = await hashNet(pepper, req.ip);
  const epostNokkel = `adminlogin:${await hashAdminSecret(pepper, "okt", epost)}`;
  const nettNokkel = `adminnett:${netHash}`;
  const [påEpost, påNett] = await Promise.all([
    db.countAttempts(epostNokkel, siden),
    db.countAttempts(nettNokkel, siden),
  ]);
  if (påEpost >= MAKS_PER_EPOST || påNett >= MAKS_PER_NETT) return tooManyRequests();
  await db.recordAttempt(epostNokkel, naa);
  await db.recordAttempt(nettNokkel, naa);

  const land = (Array.isArray(req.headers["x-vercel-ip-country"])
    ? req.headers["x-vercel-ip-country"][0]
    : req.headers["x-vercel-ip-country"]) ?? null;

  let innlogging;
  try {
    innlogging = await loggInnMedPassord(epost, passord);
  } catch (err) {
    if (err instanceof AuthFeil) {
      await db.audit("ukjent", "admin-innlogging-feilet", { trinn: "passord" }, {
        actorKind: "system",
      });
      return AVVIST;
    }
    throw err;
  }

  const admin = await finnAdminPaaEpost(sql, epost);
  // Bruker i Supabase uten rad hos oss, eller en sperret konto. Begge
  // skal se ut som feil passord.
  if (!admin || admin.status !== "aktiv") return AVVIST;

  const maaHaTotrinn = krevesTotrinn(admin.rolle, admin.krevTotrinn);
  const faktor = innlogging.faktorer[0];

  /* --- Totrinn kreves, men er ikke satt opp --- */
  if (maaHaTotrinn && !faktor) {
    const segl = forsegle(pepper, {
      adminId: admin.id,
      accessToken: innlogging.accessToken,
      faktorId: "",
      utfordringId: "",
      utloper: naa + TOTRINN_LEVETID_SEK,
    });
    return {
      status: 200,
      body: { trinn: "totrinn-oppsett", navn: admin.navn },
      cookies: [settKapsel(TOTRINN_KAPSEL, segl, TOTRINN_LEVETID_SEK)],
    };
  }

  /* --- Totrinn kreves og er satt opp --- */
  if (maaHaTotrinn && faktor) {
    const utfordringId = await utfordreTotp(innlogging.accessToken, faktor.id);
    const segl = forsegle(pepper, {
      adminId: admin.id,
      accessToken: innlogging.accessToken,
      faktorId: faktor.id,
      utfordringId,
      utloper: naa + TOTRINN_LEVETID_SEK,
    });
    return {
      status: 200,
      body: { trinn: "totrinn", navn: admin.navn },
      cookies: [settKapsel(TOTRINN_KAPSEL, segl, TOTRINN_LEVETID_SEK)],
    };
  }

  /* --- Ingen totrinnskrav: revisor med krev_totrinn = false --- */
  const token = nyHemmelighet();
  await opprettOkt(sql, {
    id: newId(),
    adminId: admin.id,
    tokenHash: await hashAdminSecret(pepper, "okt", token),
    aal: "aal1",
    levetidSek: OKT_LEVETID_SEK,
    netHash,
    land,
  });
  await merkInnlogging(sql, admin.id);
  await db.clearAttempts(epostNokkel);
  await db.audit(`${admin.navn} <${admin.epost}>`, "admin-innlogging", { totrinn: false }, {
    actorId: admin.id,
    actorKind: "admin",
  });

  return {
    status: 200,
    body: { trinn: "innlogget", navn: admin.navn, rolle: admin.rolle },
    cookies: [settKapsel(OKT_KAPSEL, token, OKT_LEVETID_SEK)],
  };
}, { cors: false });
