/**
 * POST /api/v1/admin/auth/konto — egen konto: totrinn og passord.
 *
 * Fire handlinger, valgt med feltet `handling`:
 *
 *   totrinn-start   {passord}            → QR-kode og hemmelighet
 *   totrinn-aktiver {faktorId, kode}     → reservekoder, vist ÉN gang
 *   nytt-passord    {gammelt, nytt}      → passordet byttes, alle økter rives
 *   nye-reservekoder {passord}           → nye koder, de gamle blir ugyldige
 *
 * Alle fire krever passordet på nytt. Det er ikke tungvinthet: å legge
 * til en ny totrinnsfaktor eller bytte passord fra en økt noen andre har
 * overtatt, er nettopp måten en angriper ville gjort tilgangen sin varig
 * på. Samtidig er det passordet som gir oss et ferskt Supabase-token,
 * som trengs for å snakke med Supabase Auth i det hele tatt.
 */

import { hashAdminSecret } from "@ordlyd/license-core";
import { vercelHandler, requireString } from "../../../../src/http.js";
import { ok, badRequest, unauthorized, getDb, getSql, getPepper } from "../../../../src/runtime.js";
import { loesInnlogget, erNektet, krevPanelhode, somAktor } from "../../../../src/admin-auth.js";
import {
  finnAdmin, lagreReservekoder, tilbakekallAlleOkter,
} from "../../../../src/admin-identitet.js";
import {
  loggInnMedPassord, startTotp, bekreftTotp, utfordreTotp, settPassord, AuthFeil,
} from "../../../../src/supabase-auth.js";
import { lagReservekoder, slettKapsel, OKT_KAPSEL } from "../../../../src/okt.js";
import { sjekkPassord, PASSORDKRAV } from "../../../../src/passord.js";

export default vercelHandler("POST", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;
  const vakt = krevPanelhode(req, meg);
  if (vakt) return vakt;

  if (meg.kilde !== "okt") return badRequest("dette gjelder bare innloggede personer");

  const pepper = getPepper();
  const db = getDb();
  const sql = getSql();
  const handling = requireString(req.body, "handling");

  const admin = await finnAdmin(sql, meg.adminId);
  if (!admin) return unauthorized();

  /** Passordet på nytt gir oss et ferskt Supabase-token. */
  async function bekreftMeg(feltnavn = "passord"): Promise<string | null> {
    const passord = requireString(req.body, feltnavn);
    if (!passord) return null;
    try {
      const p = await loggInnMedPassord(admin!.epost, passord);
      return p.accessToken;
    } catch (err) {
      if (err instanceof AuthFeil) return null;
      throw err;
    }
  }

  /* ---------------- Sette opp totrinn ---------------- */
  if (handling === "totrinn-start") {
    const token = await bekreftMeg();
    if (!token) return unauthorized();
    const p = await startTotp(token, `Ordlyd panel — ${admin.navn}`);
    return ok({ faktorId: p.faktorId, qrKode: p.qrKode, hemmelighet: p.hemmelighet });
  }

  if (handling === "totrinn-aktiver") {
    const faktorId = requireString(req.body, "faktorId");
    const kode = requireString(req.body, "kode");
    const passordToken = await bekreftMeg();
    if (!passordToken) return unauthorized();
    if (!faktorId || !kode) return badRequest("faktorId og kode er påkrevd");

    try {
      const utfordring = await utfordreTotp(passordToken, faktorId);
      await bekreftTotp(passordToken, faktorId, utfordring, kode.trim());
    } catch (err) {
      if (err instanceof AuthFeil) return badRequest("Koden stemmer ikke. Prøv den neste appen viser.");
      throw err;
    }

    // Reservekodene lages først når faktoren faktisk virker — ellers
    // ville noen sittet igjen med koder til en konto uten totrinn.
    const koder = lagReservekoder();
    await lagreReservekoder(
      sql,
      admin.id,
      await Promise.all(koder.map((k) => hashAdminSecret(pepper, "recovery", k))),
    );
    const a = somAktor(meg);
    await db.audit(a.actor, "totrinn-aktivert", {}, {
      actorId: a.actorId, actorKind: a.actorKind, tenantId: null,
    });

    return ok({
      /*
       * Eneste gang kodene finnes i klartekst — samme mønster som
       * engangs-eksporten ved medlemsimport. Serveren har bare hasher.
       */
      reservekoder: koder,
    });
  }

  /* ---------------- Nye reservekoder ---------------- */
  if (handling === "nye-reservekoder") {
    const token = await bekreftMeg();
    if (!token) return unauthorized();
    const koder = lagReservekoder();
    await lagreReservekoder(
      sql,
      admin.id,
      await Promise.all(koder.map((k) => hashAdminSecret(pepper, "recovery", k))),
    );
    const a = somAktor(meg);
    await db.audit(a.actor, "nye-reservekoder", {}, {
      actorId: a.actorId, actorKind: a.actorKind, tenantId: null,
    });
    return ok({ reservekoder: koder });
  }

  /* ---------------- Bytte passord ---------------- */
  if (handling === "nytt-passord") {
    const nytt = requireString(req.body, "nytt");
    if (!nytt) return badRequest("nytt passord er påkrevd");

    const feil = sjekkPassord(nytt, { epost: admin.epost, navn: admin.navn });
    if (feil.length) {
      return { status: 400, body: { feil: "passordkrav", krav: PASSORDKRAV, mangler: feil } };
    }

    const token = await bekreftMeg("gammelt");
    if (!token) return unauthorized();
    await settPassord(token, nytt);

    // Alle økter rives, også denne. Et passordbytte er ofte svaret på
    // «jeg tror noen har vært inne» — da må også deres økt dø.
    const antall = await tilbakekallAlleOkter(sql, admin.id);
    const a = somAktor(meg);
    await db.audit(a.actor, "byttet-passord", { revne_okter: antall }, {
      actorId: a.actorId, actorKind: a.actorKind, tenantId: null,
    });

    return {
      status: 200,
      body: { ok: true, revneOkter: antall, melding: "Passordet er byttet. Logg inn på nytt." },
      cookies: [slettKapsel(OKT_KAPSEL)],
    };
  }

  return badRequest("ukjent handling");
}, { cors: false });
