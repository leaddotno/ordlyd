/**
 * In-memory-implementasjon av Db — brukes i tester og lokal utvikling.
 * Semantikken speiler Postgres-skjemaet i supabase/migrations/.
 */

import type { Db, EntryStatus, Install, LicensePool, PoolEntry, Tenant } from "./types.js";

export class MemoryDb implements Db {
  tenants = new Map<string, Tenant>();
  pools = new Map<string, LicensePool>();
  entries = new Map<string, PoolEntry>();
  installs = new Map<string, Install>();
  denied = new Set<string>();
  attempts = new Map<string, number[]>();
  nets = new Map<string, Set<string>>(); // `${entryId}|${day}` → netHash-sett
  auditLog: Array<{ actor: string; action: string; details: Record<string, unknown> }> = [];

  async getTenant(id: string) {
    return this.tenants.get(id) ?? null;
  }
  async getPool(id: string) {
    return this.pools.get(id) ?? null;
  }
  async createTenant(t: Tenant) {
    this.tenants.set(t.id, t);
  }
  async createPool(p: LicensePool) {
    this.pools.set(p.id, p);
  }

  async createEntry(e: PoolEntry) {
    this.entries.set(e.id, e);
  }
  async findEntriesByEmailHash(emailHash: string) {
    return [...this.entries.values()].filter((e) => e.emailHash === emailHash);
  }
  async getEntry(id: string) {
    return this.entries.get(id) ?? null;
  }
  async setEntryStatus(id: string, status: EntryStatus) {
    const e = this.entries.get(id);
    if (e) e.status = status;
  }
  async touchEntry(id: string, nowSec: number) {
    const e = this.entries.get(id);
    if (e) e.lastUsedAt = nowSec;
  }
  async isDenied(emailHash: string) {
    return this.denied.has(emailHash);
  }

  async createInstall(i: Install) {
    this.installs.set(i.id, i);
  }
  async getInstall(id: string) {
    return this.installs.get(id) ?? null;
  }
  async touchInstall(id: string, version: string | null, nowSec: number) {
    const i = this.installs.get(id);
    if (i) {
      i.lastSeenAt = nowSec;
      if (version) i.version = version;
    }
  }

  async countAttempts(key: string, sinceSec: number) {
    return (this.attempts.get(key) ?? []).filter((t) => t >= sinceSec).length;
  }
  async recordAttempt(key: string, nowSec: number) {
    const list = this.attempts.get(key) ?? [];
    list.push(nowSec);
    this.attempts.set(key, list);
  }
  async clearAttempts(key: string) {
    this.attempts.delete(key);
  }

  async recordNet(entryId: string, day: string, netHash: string) {
    const key = `${entryId}|${day}`;
    const set = this.nets.get(key) ?? new Set();
    set.add(netHash);
    this.nets.set(key, set);
  }
  async distinctNets(entryId: string, day: string) {
    return this.nets.get(`${entryId}|${day}`)?.size ?? 0;
  }

  async audit(actor: string, action: string, details: Record<string, unknown>) {
    this.auditLog.push({ actor, action, details });
  }
}
