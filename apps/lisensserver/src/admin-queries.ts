/**
 * Leseoppslag for superadmin-panelet.
 *
 * Holdt utenfor Db-grensesnittet med vilje: dette er rapportering, ikke
 * domenelogikk. Db er det smale grensesnittet innlogging og fornyelse går
 * gjennom — og som testes mot MemoryDb. Rapportspørringer ville blåst det
 * opp uten å gjøre den kritiske stien tryggere.
 *
 * Ingen av disse spørringene rører e-post i klartekst eller koder. De
 * finnes ikke i basen; bare maskert visningsnavn og hasher.
 */

import type { Sql } from "./db-postgres.js";

/** Terskler for å flagge en lisens som mulig delt på nettet. */
export const FLAG_MIN_INSTALLS = 8;
export const FLAG_MIN_NETS_7D = 12;

export interface PoolSummary {
  poolId: string | null;
  poolName: string | null;
  poolStatus: string | null;
  lisenser: number;
  aktive: number;
  installasjoner: number;
}

export interface TenantSummary {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  validTo: string | null;
  pools: PoolSummary[];
}

export async function overview(sql: Sql): Promise<TenantSummary[]> {
  const rows = await sql`
    select
      t.id as tenant_id, t.slug, t.name, t.status, t.valid_to,
      p.id as pool_id, p.name as pool_name, p.status as pool_status,
      coalesce((select count(*) from pool_entries e where e.pool_id = p.id), 0)::int as lisenser,
      coalesce((select count(*) from pool_entries e where e.pool_id = p.id and e.status = 'aktiv'), 0)::int as aktive,
      coalesce((select count(*) from installs i
                join pool_entries e2 on e2.id = i.entry_id
                where e2.pool_id = p.id), 0)::int as installasjoner
    from tenants t
    left join license_pools p on p.tenant_id = t.id
    order by t.name, p.name nulls first`;

  const byTenant = new Map<string, TenantSummary>();
  for (const r of rows) {
    let tenant = byTenant.get(r.tenant_id);
    if (!tenant) {
      tenant = {
        tenantId: r.tenant_id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
        pools: [],
      };
      byTenant.set(r.tenant_id, tenant);
    }
    if (r.pool_id) {
      tenant.pools.push({
        poolId: r.pool_id,
        poolName: r.pool_name,
        poolStatus: r.pool_status,
        lisenser: r.lisenser,
        aktive: r.aktive,
        installasjoner: r.installasjoner,
      });
    }
  }
  return [...byTenant.values()];
}

export interface EntryRow {
  id: string;
  epost: string;
  status: string;
  sistBrukt: string | null;
  installasjoner: number;
  nett7d: number;
}

export async function poolEntries(sql: Sql, poolId: string, limit = 500): Promise<EntryRow[]> {
  const rows = await sql`
    select
      e.id, e.email_masked, e.status, e.last_used_at,
      coalesce((select count(*) from installs i where i.entry_id = e.id), 0)::int as installasjoner,
      coalesce((select count(distinct n.net_hash) from usage_nets n
                where n.entry_id = e.id and n.day > current_date - 7), 0)::int as nett_7d
    from pool_entries e
    where e.pool_id = ${poolId}
    order by e.last_used_at desc nulls last, e.email_masked
    limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    epost: r.email_masked,
    status: r.status,
    sistBrukt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    installasjoner: r.installasjoner,
    nett7d: r.nett_7d,
  }));
}

export interface FlaggedRow extends EntryRow {
  kunde: string;
  pool: string;
}

/**
 * Lisenser med uvanlig bruksmønster. Ingen automatisk stenging — dette er
 * en liste et menneske skal vurdere, slik planen krever.
 */
export async function flagged(sql: Sql): Promise<FlaggedRow[]> {
  const rows = await sql`
    select * from (
      select
        e.id, e.email_masked, e.status, e.last_used_at,
        t.name as kunde, p.name as pool,
        coalesce((select count(*) from installs i where i.entry_id = e.id), 0)::int as installasjoner,
        coalesce((select count(distinct n.net_hash) from usage_nets n
                  where n.entry_id = e.id and n.day > current_date - 7), 0)::int as nett_7d
      from pool_entries e
      join license_pools p on p.id = e.pool_id
      join tenants t on t.id = p.tenant_id
      where e.status = 'aktiv'
    ) x
    where x.installasjoner > ${FLAG_MIN_INSTALLS} or x.nett_7d > ${FLAG_MIN_NETS_7D}
    order by x.installasjoner desc, x.nett_7d desc
    limit 50`;
  return rows.map((r) => ({
    id: r.id,
    epost: r.email_masked,
    status: r.status,
    sistBrukt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    installasjoner: r.installasjoner,
    nett7d: r.nett_7d,
    kunde: r.kunde,
    pool: r.pool,
  }));
}

export interface AuditRow {
  tid: string;
  aktoer: string;
  handling: string;
  detaljer: unknown;
}

export async function auditTail(sql: Sql, limit = 50): Promise<AuditRow[]> {
  const rows = await sql`
    select at, actor, action, details from audit_log
    order by id desc limit ${limit}`;
  return rows.map((r) => ({
    tid: new Date(r.at).toISOString(),
    aktoer: r.actor,
    handling: r.action,
    detaljer: r.details,
  }));
}
