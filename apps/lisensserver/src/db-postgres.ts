/**
 * Postgres-implementasjon av Db, mot Supabase.
 *
 * VIKTIG for serverless: tilkoblingen går gjennom Supabases pooler
 * (Supavisor) i transaksjonsmodus på port 6543. Den modusen støtter IKKE
 * forberedte spørringer, derfor `prepare: false` — uten det feiler
 * spørringene sporadisk når flere funksjonsinstanser deler en backend.
 *
 * Vi bruker service-rollens tilkobling. Radsikkerheten i skjemaet er
 * skrudd på uten policyer nettopp fordi ingen andre roller skal komme til.
 */

import postgres from "postgres";
import type { Db, EntryStatus, Install, LicensePool, PoolEntry, Tenant } from "./types.js";

export type Sql = ReturnType<typeof postgres>;

export function createSql(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    prepare: false, // påkrevd med Supavisor i transaksjonsmodus
    max: 1, // én tilkobling per funksjonsinstans; pooleren gjør resten
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

/**
 * `valid_to` er en dato og tolkes som «gyldig til og med denne dagen»,
 * derfor legges døgnet til før sammenligning med unix-tid.
 */
function dateToInclusiveSec(value: unknown): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000) + 86_399;
}

function tsToSec(value: unknown): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

const secToDate = (sec: number): Date => new Date(sec * 1000);

export class PostgresDb implements Db {
  constructor(private sql: Sql) {}

  async getTenant(id: string): Promise<Tenant | null> {
    const [row] = await this.sql`
      select id, slug, name, status, valid_to from tenants where id = ${id}`;
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      validTo: dateToInclusiveSec(row.valid_to),
    };
  }

  async getPool(id: string): Promise<LicensePool | null> {
    const [row] = await this.sql`
      select id, tenant_id, name, status, valid_to, products
      from license_pools where id = ${id}`;
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      status: row.status,
      validTo: dateToInclusiveSec(row.valid_to),
      products: row.products ?? {},
    };
  }

  async createTenant(t: Tenant): Promise<void> {
    await this.sql`
      insert into tenants (id, slug, name, status, valid_to)
      values (${t.id}, ${t.slug}, ${t.name}, ${t.status},
              ${t.validTo === null ? null : secToDate(t.validTo)})`;
  }

  async createPool(p: LicensePool): Promise<void> {
    await this.sql`
      insert into license_pools (id, tenant_id, name, status, valid_to, products)
      values (${p.id}, ${p.tenantId}, ${p.name}, ${p.status},
              ${p.validTo === null ? null : secToDate(p.validTo)},
              ${this.sql.json(p.products)})`;
  }

  async createEntry(e: PoolEntry): Promise<void> {
    await this.sql`
      insert into pool_entries (id, pool_id, email_hash, email_masked, code_hash, status)
      values (${e.id}, ${e.poolId}, ${e.emailHash}, ${e.emailMasked}, ${e.codeHash}, ${e.status})`;
  }

  private toEntry(row: Record<string, unknown>): PoolEntry {
    return {
      id: row.id as string,
      poolId: row.pool_id as string,
      emailHash: row.email_hash as string,
      emailMasked: row.email_masked as string,
      codeHash: row.code_hash as string,
      status: row.status as EntryStatus,
      lastUsedAt: tsToSec(row.last_used_at),
    };
  }

  async findEntriesByEmailHash(emailHash: string): Promise<PoolEntry[]> {
    const rows = await this.sql`
      select id, pool_id, email_hash, email_masked, code_hash, status, last_used_at
      from pool_entries where email_hash = ${emailHash}`;
    return rows.map((r) => this.toEntry(r));
  }

  async getEntry(id: string): Promise<PoolEntry | null> {
    const [row] = await this.sql`
      select id, pool_id, email_hash, email_masked, code_hash, status, last_used_at
      from pool_entries where id = ${id}`;
    return row ? this.toEntry(row) : null;
  }

  async setEntryStatus(id: string, status: EntryStatus): Promise<void> {
    await this.sql`update pool_entries set status = ${status} where id = ${id}`;
  }

  async touchEntry(id: string, nowSec: number): Promise<void> {
    await this.sql`update pool_entries set last_used_at = ${secToDate(nowSec)} where id = ${id}`;
  }

  async isDenied(emailHash: string): Promise<boolean> {
    const [row] = await this.sql`
      select 1 as hit from deny_entries where email_hash = ${emailHash}`;
    return Boolean(row);
  }

  async createInstall(i: Install): Promise<void> {
    await this.sql`
      insert into installs (id, entry_id, secret_hash, product, version, last_seen_at)
      values (${i.id}, ${i.entryId}, ${i.secretHash}, ${i.product}, ${i.version},
              ${i.lastSeenAt === null ? null : secToDate(i.lastSeenAt)})`;
  }

  async getInstall(id: string): Promise<Install | null> {
    const [row] = await this.sql`
      select id, entry_id, secret_hash, product, version, last_seen_at
      from installs where id = ${id}`;
    if (!row) return null;
    return {
      id: row.id,
      entryId: row.entry_id,
      secretHash: row.secret_hash,
      product: row.product,
      version: row.version,
      lastSeenAt: tsToSec(row.last_seen_at),
    };
  }

  async touchInstall(id: string, version: string | null, nowSec: number): Promise<void> {
    await this.sql`
      update installs
      set last_seen_at = ${secToDate(nowSec)},
          version = coalesce(${version}, version)
      where id = ${id}`;
  }

  async countAttempts(key: string, sinceSec: number): Promise<number> {
    const [row] = await this.sql`
      select count(*)::int as n from login_attempts
      where key = ${key} and at >= ${secToDate(sinceSec)}`;
    return row?.n ?? 0;
  }

  async recordAttempt(key: string, nowSec: number): Promise<void> {
    await this.sql`insert into login_attempts (key, at) values (${key}, ${secToDate(nowSec)})`;
  }

  async clearAttempts(key: string): Promise<void> {
    await this.sql`delete from login_attempts where key = ${key}`;
  }

  async recordNet(entryId: string, day: string, netHash: string): Promise<void> {
    await this.sql`
      insert into usage_nets (entry_id, day, net_hash)
      values (${entryId}, ${day}, ${netHash})
      on conflict do nothing`;
  }

  async distinctNets(entryId: string, day: string): Promise<number> {
    const [row] = await this.sql`
      select count(*)::int as n from usage_nets
      where entry_id = ${entryId} and day = ${day}`;
    return row?.n ?? 0;
  }

  async recordReceipt(r: {
    entryId: string;
    installId: string;
    kid: string;
    issuedAt: number;
    expiresAt: number;
  }): Promise<void> {
    await this.sql`
      insert into receipts (entry_id, install_id, kid, issued_at, expires_at)
      values (${r.entryId}, ${r.installId}, ${r.kid},
              ${secToDate(r.issuedAt)}, ${secToDate(r.expiresAt)})`;
  }

  async audit(actor: string, action: string, details: Record<string, unknown>): Promise<void> {
    // postgres.json vil ha en JSONValue; en gjennomgang av JSON.stringify
    // garanterer at bare serialiserbare verdier havner i kolonnen.
    const safe = JSON.parse(JSON.stringify(details)) as Record<string, string | number | boolean | null>;
    await this.sql`
      insert into audit_log (actor, action, details)
      values (${actor}, ${action}, ${this.sql.json(safe)})`;
  }
}
