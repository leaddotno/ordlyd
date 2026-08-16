/**
 * GET /api/v1/admin/entries?poolId=… — lisensene i en pool.
 *
 * Viser maskert e-post, status, sist brukt, antall installasjoner og antall
 * ulike nett siste uke. Koden vises aldri — den finnes ikke i basen.
 *
 * Avgrenset: en kundeadmin ser bare pooler hos sine egne kunder, og en
 * fremmed pool svarer «finnes ikke» framfor «ikke din».
 */

import { vercelHandler } from "../../../src/http.js";
import { ok, badRequest, getSql, getDb } from "../../../src/runtime.js";
import { loesInnlogget, erNektet, somAktor } from "../../../src/admin-auth.js";
import { krevKunde } from "../../../src/tilgang.js";
import { poolEntries, poolensKunde } from "../../../src/admin-queries.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UKJENT = { status: 404, body: { feil: "ukjent-pool" } };

export default vercelHandler("GET", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;

  const poolId = req.query.poolId;
  if (!poolId || !UUID.test(poolId)) return badRequest("poolId må være en gyldig UUID");

  const sql = getSql();
  const kunde = await poolensKunde(sql, poolId);
  if (!kunde || krevKunde(meg, kunde)) return UKJENT;

  const lisenser = await poolEntries(sql, poolId);

  // Oppslag i personopplysninger skal kunne spores, ikke bare endringer
  // (personvernforordningen art. 5). Vi logger pool og treffantall —
  // aldri adressen, som uansett ikke finnes i lesbar form.
  const a = somAktor(meg);
  await getDb().audit(a.actor, "vis-lisenser", { pool: poolId, antall: lisenser.length }, {
    actorId: a.actorId,
    actorKind: a.actorKind,
    tenantId: kunde,
  });

  return ok({ lisenser });
}, { cors: false });
