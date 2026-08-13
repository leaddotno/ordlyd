/**
 * GET /api/v1/admin/entries?poolId=… — lisensene i en pool.
 *
 * Viser maskert e-post, status, sist brukt, antall installasjoner og antall
 * ulike nett siste uke. Koden vises aldri — den finnes ikke i basen.
 */

import { vercelHandler } from "../../../src/http.js";
import { ok, badRequest, requireEnv } from "../../../src/runtime.js";
import { requireAdmin } from "../../../src/admin-auth.js";
import { createSql } from "../../../src/db-postgres.js";
import { poolEntries } from "../../../src/admin-queries.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default vercelHandler("GET", async (req) => {
  const denied = requireAdmin(req.headers);
  if (denied) return denied;

  const poolId = req.query.poolId;
  if (!poolId || !UUID.test(poolId)) return badRequest("poolId må være en gyldig UUID");

  const sql = createSql(requireEnv("DATABASE_URL"));
  return ok({ lisenser: await poolEntries(sql, poolId) });
});
