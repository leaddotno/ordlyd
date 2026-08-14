/**
 * Vercel Cron — daglig opprydding som holder lagringstidene i
 * personvernerklæringen.
 *
 * Hver periode her svarer til en linje i tabellen under punkt 5 i
 * erklæringen. Endres en av dem, må erklæringen endres samtidig — en
 * personvernerklæring som lover kortere sletting enn koden utfører, er en
 * forpliktelse vi bryter hver dag.
 *
 * Vercel sender Authorization: Bearer $CRON_SECRET.
 */

import { vercelHandler } from "../../src/http.js";
import { getDb, ok, unauthorized, bearerToken, secretEquals, requireEnv } from "../../src/runtime.js";
import { createSql } from "../../src/db-postgres.js";
// Cron bruker CRON_SECRET, ikke ADMIN_TOKEN — derfor egen sjekk her.

/** IP-avledede data skal ikke leve lenger enn en måned. */
export const NET_RETENTION_DAYS = 30;
/** Trengs bare til ratebegrensningsvinduet på 15 minutter. */
export const ATTEMPT_RETENTION_DAYS = 1;
/** Installasjoner uten kontakt så lenge er forlatt; brukeren logger bare inn på nytt. */
export const INSTALL_RETENTION_DAYS = 365;
/** Lisenser slettes 12 måneder etter at kundens eller poolens periode er over. */
export const ENTRY_RETENTION_DAYS = 365;
/** Revisjonsspor og utstedte kvitteringer. */
export const AUDIT_RETENTION_DAYS = 730;

export default vercelHandler("GET", async (req) => {
  const token = bearerToken(req.headers);
  if (!token || !secretEquals(token, requireEnv("CRON_SECRET"))) return unauthorized();

  const sql = createSql(requireEnv("DATABASE_URL"));

  const forsok = await sql`
    delete from login_attempts
    where at < now() - ${`${ATTEMPT_RETENTION_DAYS} days`}::interval`;

  const nettnokler = await sql`
    delete from usage_nets
    where day < current_date - ${NET_RETENTION_DAYS}::int`;

  /**
   * Lisenser med utløpt periode. Merk at en løpende lisens — der både
   * kunden og poolen har `valid_to = null` — aldri treffes her. Det er med
   * vilje: sletting skal utløses av en dato noen faktisk har satt, ikke av
   * at det er lenge siden noen brukte tjenesten.
   */
  const lisenser = await sql`
    delete from pool_entries e
    using license_pools p, tenants t
    where e.pool_id = p.id
      and p.tenant_id = t.id
      and (
        (t.valid_to is not null and t.valid_to < current_date - ${ENTRY_RETENTION_DAYS}::int)
        or (p.valid_to is not null and p.valid_to < current_date - ${ENTRY_RETENTION_DAYS}::int)
      )`;

  // Kjøres etter lisensslettingen, som alt har tatt med seg installasjonene
  // sine via kaskade. Dette fanger de forlatte som står igjen.
  const installasjoner = await sql`
    delete from installs
    where last_seen_at is not null
      and last_seen_at < now() - ${`${INSTALL_RETENTION_DAYS} days`}::interval`;

  const kvitteringer = await sql`
    delete from receipts
    where issued_at < now() - ${`${AUDIT_RETENTION_DAYS} days`}::interval`;

  const revisjon = await sql`
    delete from audit_log
    where at < now() - ${`${AUDIT_RETENTION_DAYS} days`}::interval`;

  const resultat = {
    slettedeForsok: forsok.count,
    slettedeNettnokler: nettnokler.count,
    slettedeLisenser: lisenser.count,
    slettedeInstallasjoner: installasjoner.count,
    slettedeKvitteringer: kvitteringer.count,
    slettedeRevisjonsposter: revisjon.count,
  };

  // Loggføres etter slettingen, slik at posten om selve oppryddingen ikke
  // ryker i samme runde.
  await getDb().audit("cron", "cleanup", resultat);
  return ok(resultat);
});
