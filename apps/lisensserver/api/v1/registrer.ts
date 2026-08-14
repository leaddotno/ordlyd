/**
 * POST /api/v1/registrer — hvem som helst kan hente en gratis prøvelisens.
 *
 * ┌─ SVARET SKAL ALLTID VÆRE DET SAMME ──────────────────────────────────┐
 * │ Uansett om adressen fantes, var utløpt, var stengt eller er helt ny:  │
 * │ samme 200-svar med samme tekst.                                      │
 * │                                                                      │
 * │ Grunnen er ikke pedanteri. Ulike svar ville gjort endepunktet til et  │
 * │ oppslagsverk over hvem som bruker Ordlyd — og det er i praksis en     │
 * │ opplysning om at personen har lese- og skrivevansker, altså en        │
 * │ særlig kategori personopplysning etter GDPR artikkel 9.               │
 * │                                                                      │
 * │ Eneste unntak er ratebegrensning (429), som ikke avslører noe om      │
 * │ adressen — bare at det er sendt for mange forespørsler.               │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { vercelHandler, requireString } from "../../src/http.js";
import { getDb, getPepper, newId, nowSec, ok, badRequest, tooManyRequests, requireEnv } from "../../src/runtime.js";
import { registrer } from "../../src/logic.js";
import { sendEpost, velkomstEpost } from "../../src/epost.js";
import { normalizeEmail } from "@ordlyd/license-core";

/** Enkel formsjekk. Vi kan ikke vite om adressen finnes — det avgjør e-posten. */
const EPOST_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const SAMME_SVAR = {
  ok: true,
  melding:
    "Hvis adressen kan brukes, har vi sendt en e-post med lisenskoden. " +
    "Sjekk også søppelpost. E-posten kommer fra post@hjelp.ordlyd.no.",
};

export default vercelHandler("POST", async (req) => {
  const raa = requireString(req.body, "email");
  if (!raa) return badRequest("email er påkrevd");

  const email = normalizeEmail(raa);
  if (email.length > 254 || !EPOST_RE.test(email)) {
    // Formfeil er trygt å si fra om: det avslører ingenting om hvem som
    // finnes, og uten det ville en skrivefeil bare gitt taushet.
    return badRequest("Dette ser ikke ut som en gyldig e-postadresse.");
  }

  const utfall = await registrer(getDb(), getPepper(), { email, ip: req.ip, nowSec: nowSec() }, newId);

  if (utfall.slag === "for-mange-forsok") return tooManyRequests();

  if (utfall.slag === "registrering-lukket") {
    return {
      status: 503,
      body: {
        feil: "registrering-lukket",
        melding:
          "Registrering av nye prøvelisenser er midlertidig stengt. " +
          "Kontakt foreningen, skolen eller kommunen din for å få tilgang.",
      },
    };
  }

  if (utfall.slag === "ingen-provepool") {
    // Oppsettsfeil hos oss, ikke brukerens problem — men vi later ikke som
    // det gikk bra.
    console.error("[lisensserver] prove_pool_id mangler i app_settings");
    return { status: 503, body: { feil: "oppsett-mangler", melding: "Noe er feil hos oss. Prøv igjen senere." } };
  }

  // Herfra og ned: alle utfall gir SAMME svar til klienten.
  if (utfall.slag === "stengt" || utfall.slag === "utlopt-uten-fornyelse") {
    return ok(SAMME_SVAR);
  }

  const { emne, html, tekst } = velkomstEpost({
    kode: utfall.code,
    validTo: utfall.validTo,
    slag: utfall.slag === "gjenopprettet" ? "gjenopprettet" : utfall.slag === "fornyet" ? "fornyet" : "ny",
    ...(utfall.slag === "gjenopprettet" ? { pool: utfall.pool } : {}),
  });

  const sendt = await sendEpost({
    apiKey: requireEnv("RESEND_API_KEY"),
    til: email,
    emne,
    html,
    tekst,
    // Én nøkkel per adresse per time: dobbeltklikk og gjenforsøk gir ikke to
    // e-poster, men en ny registrering senere kommer fram.
    idempotencyKey: `registrer/${utfall.code}`,
  });

  if (!sendt.ok) {
    // Lisensen er alt opprettet med den nye koden. Vi kan ikke sende koden i
    // svaret — den skal bare til innehaveren av adressen — så brukeren må
    // prøve igjen. Et nytt forsøk lager en fersk kode, så det er trygt.
    console.error("[lisensserver] e-post feilet:", sendt.grunn, sendt.detalj);
    const kvote = sendt.grunn === "kvote-brukt-opp";
    return {
      status: kvote ? 503 : 502,
      body: {
        feil: "epost-feilet",
        melding: kvote
          ? "Vi kan ikke sende e-post akkurat nå. Prøv igjen i morgen, eller kontakt oss."
          : "Vi fikk ikke sendt e-posten. Prøv igjen om noen minutter.",
      },
    };
  }

  return ok(SAMME_SVAR);
});
