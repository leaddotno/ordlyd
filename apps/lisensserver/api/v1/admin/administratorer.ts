/**
 * GET  /api/v1/admin/administratorer — hvem har tilgang
 * POST /api/v1/admin/administratorer — opprett eller endre
 *
 * Bare eier. Det er den ene rollen som styrer hvem andre som slipper til.
 *
 * Den aller første eier-kontoen opprettes med nødinngangen: kall dette
 * endepunktet med `Authorization: Bearer <ADMIN_TOKEN>`. Etter det bør
 * ADMIN_TOKEN legges bort til den trengs igjen.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { ok, badRequest, getDb, getSql, newId } from "../../../src/runtime.js";
import { loesInnlogget, erNektet, krevPanelhode, somAktor } from "../../../src/admin-auth.js";
import { krevAdministratorstyring, omfangErGyldig, forklarOmfang, type Rolle } from "../../../src/tilgang.js";
import {
  listAdmins, finnAdmin, finnAdminPaaEpost, opprettAdmin, endreAdmin,
  settKunder, tilbakekallAlleOkter, tellEiere,
} from "../../../src/admin-identitet.js";
import { opprettBruker, settPassordSomAdmin, nullstillTotp, AuthFeil } from "../../../src/supabase-auth.js";
import { sjekkPassord, PASSORDKRAV } from "../../../src/passord.js";
import { sendEpost } from "../../../src/epost.js";

const ROLLER: Rolle[] = ["eier", "forvalter", "kundeadmin", "revisor"];
const EPOST_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Varsler alle eiere. En endring i hvem som har tilgang skal ikke skje
 * stille — det er hele poenget med at loggen kan tilskrives.
 *
 * Feiler utsendingen, skal ikke selve endringen rulles tilbake: det
 * ville gitt en halvferdig tilstand som er verre enn et manglende
 * varsel. Loggposten er uansett skrevet.
 */
async function varsleEiere(sql: any, emne: string, linjer: string[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[lisensserver] RESEND_API_KEY mangler — eierne ble ikke varslet");
    return;
  }
  const hendelse = newId();
  const eiere = (await listAdmins(sql)).filter((a) => a.rolle === "eier" && a.status === "aktiv");
  for (const e of eiere) {
    const fornavn = e.navn.split(" ")[0];
    await sendEpost({
      apiKey,
      til: e.epost,
      emne,
      tekst: [`Hei ${fornavn},`, "", ...linjer.map(rentTekst), "", "— Ordlyd"].join("\n"),
      html: `<p>Hei ${fornavn},</p><p>${linjer.join("<br>")}</p><p>— Ordlyd</p>`,
      idempotencyKey: `adminvarsel/${hendelse}/${e.id}`,
    }).catch((f) => console.error("[lisensserver] varsel til eier feilet", f));
  }
}

const rentTekst = (s: string): string => s.replace(/<[^>]+>/g, "");

async function handter(req: Parameters<Parameters<typeof vercelHandler>[1]>[0]) {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;
  const vakt = krevAdministratorstyring(meg);
  if (vakt) return vakt;

  const sql = getSql();
  const db = getDb();
  const a = somAktor(meg);

  if (req.method === "GET") {
    return ok({ administratorer: await listAdmins(sql), roller: ROLLER });
  }

  const panelvakt = krevPanelhode(req, meg);
  if (panelvakt) return panelvakt;

  const handling = requireString(req.body, "handling") ?? "opprett";

  /* ---------------- Opprett ---------------- */
  if (handling === "opprett") {
    const epost = requireString(req.body, "epost")?.trim().toLowerCase();
    const navn = requireString(req.body, "navn");
    const rolle = requireString(req.body, "rolle") as Rolle | null;
    const passord = requireString(req.body, "passord");
    const kunder = Array.isArray(req.body.kunder) ? (req.body.kunder as string[]) : [];

    if (!epost || !EPOST_RE.test(epost)) return badRequest("oppgi en gyldig e-postadresse");
    if (!navn) return badRequest("navn er påkrevd");
    if (!rolle || !ROLLER.includes(rolle)) return badRequest(`rolle må være en av: ${ROLLER.join(", ")}`);
    if (!passord) return badRequest("passord er påkrevd");

    const omfang = rolle === "eier" || rolle === "forvalter" ? null : kunder;
    if (!omfangErGyldig(rolle, omfang)) {
      return badRequest(`ugyldig kombinasjon av rolle og kunder. ${forklarOmfang(rolle)}`);
    }

    const feil = sjekkPassord(passord, { epost, navn });
    if (feil.length) return { status: 400, body: { feil: "passordkrav", krav: PASSORDKRAV, mangler: feil } };

    if (await finnAdminPaaEpost(sql, epost)) return badRequest(`${epost} har allerede tilgang`);

    let brukerId: string;
    try {
      brukerId = await opprettBruker(epost, passord);
    } catch (err) {
      if (err instanceof AuthFeil) return badRequest(`Supabase avviste kontoen: ${err.message}`);
      throw err;
    }

    // Revisor er den ene rollen der totrinn er valgfritt. Eier kan
    // likevel kreve det per konto, f.eks. hvis en kunde forlanger det.
    const krevTotrinn = rolle === "revisor" ? req.body.krevTotrinn === true : true;

    await opprettAdmin(sql, {
      id: brukerId, epost, navn, rolle, krevTotrinn,
      opprettetAv: meg.kilde === "okt" ? meg.adminId : null,
    });
    if (omfang) await settKunder(sql, brukerId, omfang);

    await db.audit(a.actor, "opprett-administrator", { admin: brukerId, epost, rolle, kunder: omfang?.length ?? "alle" }, {
      actorId: a.actorId, actorKind: a.actorKind, tenantId: null,
    });
    await varsleEiere(sql, "Ny administrator i Ordlyd", [
      `<strong>${navn}</strong> (${epost}) har fått rollen <strong>${rolle}</strong>.`,
      `Opprettet av: ${a.actor}.`,
      krevTotrinn
        ? "Kontoen må sette opp totrinn ved første innlogging."
        : "Kontoen har ikke krav om totrinn.",
    ]);

    return ok({
      adminId: brukerId, epost, navn, rolle, krevTotrinn,
      melding: krevTotrinn
        ? "Kontoen er opprettet. Ved første innlogging blir hun bedt om å sette opp totrinn."
        : "Kontoen er opprettet.",
    });
  }

  /* ---------------- Endre ---------------- */
  if (handling === "endre") {
    const adminId = requireString(req.body, "adminId");
    if (!adminId) return badRequest("adminId er påkrevd");
    const mål = await finnAdmin(sql, adminId);
    if (!mål) return badRequest("ukjent administrator");

    const rolle = (requireString(req.body, "rolle") as Rolle | null) ?? mål.rolle;
    if (!ROLLER.includes(rolle)) return badRequest(`ukjent rolle ${rolle}`);
    const kunder = Array.isArray(req.body.kunder) ? (req.body.kunder as string[]) : mål.kunder;
    const omfang = rolle === "eier" || rolle === "forvalter" ? null : kunder;
    if (!omfangErGyldig(rolle, omfang)) {
      return badRequest(`ugyldig kombinasjon av rolle og kunder. ${forklarOmfang(rolle)}`);
    }

    const status = (requireString(req.body, "status") as "aktiv" | "sperret" | null) ?? mål.status;
    if (status !== "aktiv" && status !== "sperret") return badRequest("status må være aktiv eller sperret");

    // Den siste aktive eieren kan ikke sperres eller degraderes bort.
    // Uten dette kunne systemet ende opp uten noen som kan gi tilgang,
    // og nødinngangen ville vært eneste vei tilbake.
    const mister = mål.rolle === "eier" && (rolle !== "eier" || status !== "aktiv");
    if (mister && (await tellEiere(sql)) <= 1) {
      return badRequest("dette er den siste aktive eieren — opprett en ny eier først");
    }

    await endreAdmin(sql, adminId, {
      navn: requireString(req.body, "navn") ?? undefined,
      rolle,
      status,
      krevTotrinn: typeof req.body.krevTotrinn === "boolean" ? req.body.krevTotrinn : undefined,
    });
    await settKunder(sql, adminId, omfang ?? []);

    // Rolle- eller omfangsendring skal virke med én gang, ikke ved neste
    // innlogging. Derfor rives øktene.
    const revne = await tilbakekallAlleOkter(sql, adminId);

    await db.audit(a.actor, "endre-administrator", {
      admin: adminId, rolle, status, kunder: omfang?.length ?? "alle", revne_okter: revne,
    }, { actorId: a.actorId, actorKind: a.actorKind, tenantId: null });
    await varsleEiere(sql, "Endret tilgang i Ordlyd", [
      `<strong>${mål.navn}</strong> (${mål.epost}) er endret til <strong>${rolle}</strong>, status <strong>${status}</strong>.`,
      `Utført av: ${a.actor}.`,
    ]);

    return ok({ adminId, rolle, status, revneOkter: revne });
  }

  /* ---------------- Nullstill totrinn eller passord ---------------- */
  if (handling === "nullstill-totrinn" || handling === "nytt-passord") {
    const adminId = requireString(req.body, "adminId");
    if (!adminId) return badRequest("adminId er påkrevd");
    const mål = await finnAdmin(sql, adminId);
    if (!mål) return badRequest("ukjent administrator");

    if (handling === "nullstill-totrinn") {
      const fjernet = await nullstillTotp(adminId);
      const revne = await tilbakekallAlleOkter(sql, adminId);
      await db.audit(a.actor, "nullstill-totrinn", { admin: adminId, fjernet, revne_okter: revne }, {
        actorId: a.actorId, actorKind: a.actorKind, tenantId: null,
      });
      await varsleEiere(sql, "Totrinn nullstilt i Ordlyd", [
        `Totrinn er fjernet for <strong>${mål.navn}</strong> (${mål.epost}).`,
        `Utført av: ${a.actor}. Kontoen må sette det opp på nytt ved neste innlogging.`,
      ]);
      return ok({ adminId, fjernet, revneOkter: revne });
    }

    const nytt = requireString(req.body, "passord");
    if (!nytt) return badRequest("passord er påkrevd");
    const feil = sjekkPassord(nytt, { epost: mål.epost, navn: mål.navn });
    if (feil.length) return { status: 400, body: { feil: "passordkrav", krav: PASSORDKRAV, mangler: feil } };

    await settPassordSomAdmin(adminId, nytt);
    const revne = await tilbakekallAlleOkter(sql, adminId);
    await db.audit(a.actor, "tilbakestill-passord", { admin: adminId, revne_okter: revne }, {
      actorId: a.actorId, actorKind: a.actorKind, tenantId: null,
    });
    await varsleEiere(sql, "Passord tilbakestilt i Ordlyd", [
      `Passordet til <strong>${mål.navn}</strong> (${mål.epost}) er satt på nytt.`,
      `Utført av: ${a.actor}.`,
    ]);
    return ok({ adminId, revneOkter: revne });
  }

  return badRequest("ukjent handling");
}

const somGet = vercelHandler("GET", handter, { cors: false });
const somPost = vercelHandler("POST", handter, { cors: false });

export default function (req: any, res: any) {
  return req.method === "POST" ? somPost(req, res) : somGet(req, res);
}
