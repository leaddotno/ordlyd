/**
 * Vercel Cron — daglig opprydding som holder oppbevaringsløftene i planen.
 *
 *  - Innloggingsforsøk: slettes etter ett døgn (trengs bare til
 *    ratebegrensningsvinduet på 15 minutter).
 *  - Nettnøkler: slettes etter 30 dager. Dette er løftet om at
 *    IP-avledede data ikke lever lenger enn en måned.
 *
 * Vercel sender Authorization: Bearer $CRON_SECRET.
 */

import { vercelHandler } from "../../src/http.js";
import { getDb, ok, unauthorized, bearerToken, secretEquals, requireEnv } from "../../src/runtime.js";
import { createSql } from "../../src/db-postgres.js";

export const NET_RETENTION_DAYS = 30;
export const ATTEMPT_RETENTION_DAYS = 1;

export default vercelHandler("GET", async (req) => {
  const token = bearerToken(req.headers);
  if (!token || !secretEquals(token, requireEnv("CRON_SECRET"))) return unauthorized();

  const sql = createSql(requireEnv("DATABASE_URL"));
  const attempts = await sql`
    delete from login_attempts
    where at < now() - ${`${ATTEMPT_RETENTION_DAYS} days`}::interval`;
  const nets = await sql`
    delete from usage_nets
    where day < current_date - ${NET_RETENTION_DAYS}::int`;

  await getDb().audit("cron", "cleanup", {
    slettede_forsok: attempts.count,
    slettede_nettnokler: nets.count,
  });
  return ok({ slettedeForsok: attempts.count, slettedeNettnokler: nets.count });
});
