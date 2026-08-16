/**
 * GET  /api/v1/admin/auth/meg — hvem er jeg, og hvilke økter har jeg?
 * POST /api/v1/admin/auth/meg — logg ut (denne økten, eller alle).
 *
 * Slått sammen i én fil fordi det er samme spørsmål sett fra to sider,
 * og fordi hvert endepunkt er en egen funksjon hos Vercel.
 */

import { hashAdminSecret } from "@ordlyd/license-core";
import { vercelHandler } from "../../../../src/http.js";
import { ok, getDb, getSql, getPepper } from "../../../../src/runtime.js";
import { loesInnlogget, erNektet, somAktor } from "../../../../src/admin-auth.js";
import {
  finnLevendeOkt, tilbakekallOkt, tilbakekallAlleOkter, mineOkter, ubrukteReservekoder,
} from "../../../../src/admin-identitet.js";
import { lesKapsler, slettKapsel, OKT_KAPSEL } from "../../../../src/okt.js";
import { kanEndre, kanStyreAdministratorer, kanEndreGlobaltOppsett } from "../../../../src/tilgang.js";

async function handter(req: Parameters<Parameters<typeof vercelHandler>[1]>[0]) {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;

  const pepper = getPepper();
  const sql = getSql();
  const kapselToken = lesKapsler(req.headers.cookie)[OKT_KAPSEL];

  /* ---------------- Utlogging ---------------- */
  if (req.method === "POST") {
    const alle = req.body?.alle === true;
    let antall = 0;
    if (alle) {
      antall = await tilbakekallAlleOkter(sql, meg.adminId);
    } else if (kapselToken) {
      const funn = await finnLevendeOkt(sql, await hashAdminSecret(pepper, "okt", kapselToken));
      if (funn) {
        await tilbakekallOkt(sql, funn.okt.id);
        antall = 1;
      }
    }
    const a = somAktor(meg);
    await getDb().audit(a.actor, alle ? "logg-ut-alle" : "logg-ut", { okter: antall }, {
      actorId: a.actorId, actorKind: a.actorKind, tenantId: null,
    });
    return {
      status: 200,
      body: { ok: true, revneOkter: antall },
      cookies: [slettKapsel(OKT_KAPSEL)],
    };
  }

  /* ---------------- Hvem er jeg ---------------- */
  return ok({
    navn: meg.navn,
    epost: meg.epost,
    rolle: meg.rolle,
    kilde: meg.kilde,
    alleKunder: meg.kunder === null,
    antallKunder: meg.kunder?.length ?? null,
    kanEndre: kanEndre(meg),
    kanStyreAdministratorer: kanStyreAdministratorer(meg),
    kanEndreGlobaltOppsett: kanEndreGlobaltOppsett(meg),
    reservekoderIgjen: meg.kilde === "okt" ? await ubrukteReservekoder(sql, meg.adminId) : null,
    okter: meg.kilde === "okt" ? await mineOkter(sql, meg.adminId) : [],
  });
}

/*
 * vercelHandler låser til én metode. Her trengs to, så begge pakkes og
 * velges på metoden — enklere enn å dele i to filer for det samme.
 */
const somGet = vercelHandler("GET", handter, { cors: false });
const somPost = vercelHandler("POST", handter, { cors: false });

export default function (req: any, res: any) {
  return req.method === "POST" ? somPost(req, res) : somGet(req, res);
}
