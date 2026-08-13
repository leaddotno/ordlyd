/**
 * GET /api/v1/admin/overview — kunder, pooler og nøkkeltall til panelets forside.
 * Tar også med flaggede lisenser, slik at panelet klarer seg med ett kall.
 */

import { vercelHandler } from "../../../src/http.js";
import { ok, requireEnv } from "../../../src/runtime.js";
import { requireAdmin } from "../../../src/admin-auth.js";
import { createSql } from "../../../src/db-postgres.js";
import { overview, flagged, auditTail, FLAG_MIN_INSTALLS, FLAG_MIN_NETS_7D } from "../../../src/admin-queries.js";

export default vercelHandler("GET", async (req) => {
  const denied = requireAdmin(req.headers);
  if (denied) return denied;

  const sql = createSql(requireEnv("DATABASE_URL"));
  const [kunder, flaggede, logg] = await Promise.all([
    overview(sql),
    flagged(sql),
    auditTail(sql, 40),
  ]);

  return ok({
    kunder,
    flaggede,
    logg,
    terskler: { installasjoner: FLAG_MIN_INSTALLS, nett7d: FLAG_MIN_NETS_7D },
  });
});
