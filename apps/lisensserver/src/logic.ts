/**
 * Kjerneflytene i lisensserveren: import, innlogging, fornyelse, stenging.
 *
 * Rene funksjoner over Db-grensesnittet — tid og tilfeldighet kommer
 * utenfra eller fra license-core, aldri fra klokka direkte, slik at alt
 * er testbart.
 */

import {
  generateLicenseCode,
  generateInstallSecret,
  normalizeLicenseCode,
  isValidCodeFormat,
  hashEmail,
  hashCode,
  hashInstallSecret,
  hashNet,
  maskEmail,
  normalizeEmail,
  signReceipt,
  RECEIPT_TTL_SEC,
  RECEIPT_SOFT_TTL_SEC,
  type SigningKeyPair,
  type ReceiptPayload,
} from "@ordlyd/license-core";
import type { Db, LicensePool, PoolEntry, Tenant } from "./types.js";

export const ISSUER = "https://lisens.ordlyd.no";

/** Ratebegrensning: maks forsøk per nøkkel innenfor vinduet. */
export const RATE_WINDOW_SEC = 15 * 60;
export const MAX_ATTEMPTS_PER_EMAIL = 5;
export const MAX_ATTEMPTS_PER_NET = 20;

export interface ImportResult {
  imported: Array<{ email: string; code: string }>;
  skipped: string[];
}

/**
 * Importerer e-postadresser til en pool og genererer koder.
 * Returnerer klartekstlisten NÅ — det er engangs-eksporten som gis til
 * foreningen. Serveren beholder bare hasher.
 */
export async function importEntries(
  db: Db,
  pepper: string,
  poolId: string,
  emails: string[],
  newId: () => string,
): Promise<ImportResult> {
  const pool = await db.getPool(poolId);
  if (!pool) throw new Error(`ukjent pool ${poolId}`);

  const imported: Array<{ email: string; code: string }> = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!email.includes("@") || seen.has(email)) {
      skipped.push(raw);
      continue;
    }
    seen.add(email);
    const emailHash = await hashEmail(pepper, email);
    const existing = await db.findEntriesByEmailHash(emailHash);
    if (existing.some((e) => e.poolId === poolId)) {
      skipped.push(raw);
      continue;
    }
    const code = generateLicenseCode();
    await db.createEntry({
      id: newId(),
      poolId,
      emailHash,
      emailMasked: maskEmail(email),
      codeHash: await hashCode(pepper, email, code),
      status: "aktiv",
      lastUsedAt: null,
    });
    imported.push({ email, code });
  }
  await db.audit("superadmin", "import", { poolId, antall: imported.length, hoppet_over: skipped.length });
  return { imported, skipped };
}

export interface LoginInput {
  email: string;
  code: string;
  product: string;
  version?: string;
  ip: string;
  nowSec: number;
}

export type LoginResult =
  | { ok: true; receipt: string; installId: string; installSecret: string }
  | { ok: false; reason: "for-mange-forsok" | "feil-kode" | "stengt" | "utenfor-periode" };

async function findActivePoolAndTenant(
  db: Db,
  entry: PoolEntry,
  nowSec: number,
): Promise<LicensePool | null> {
  const pool = await db.getPool(entry.poolId);
  if (!pool || pool.status !== "aktiv") return null;
  if (pool.validTo !== null && nowSec > pool.validTo) return null;
  const tenant = await db.getTenant(pool.tenantId);
  if (!tenant || tenant.status !== "aktiv") return null;
  if (tenant.validTo !== null && nowSec > tenant.validTo) return null;
  return pool;
}

/**
 * Når slutter lisensen å gjelde? Den strengeste av kundens og poolens
 * sluttdato. Null betyr løpende — det vanlige, og det som gjør at klienten
 * kan slutte å vise en nedtelling som ikke betyr noe.
 */
function licenseValidTo(tenant: Tenant, pool: LicensePool): number | null {
  const datoer = [tenant.validTo, pool.validTo].filter((v): v is number => v !== null);
  return datoer.length ? Math.min(...datoer) : null;
}

async function issueReceipt(
  db: Db,
  keys: SigningKeyPair,
  entry: PoolEntry,
  pool: LicensePool,
  tenant: Tenant,
  installId: string,
  nowSec: number,
  config: ServerConfig,
): Promise<string> {
  const payload: ReceiptPayload = {
    v: 1,
    kid: keys.kid,
    iss: ISSUER,
    sub: `code:${entry.emailHash}`,
    tenant: tenant.slug,
    install: installId,
    products: pool.products,
    iat: nowSec,
    softExp: nowSec + RECEIPT_SOFT_TTL_SEC,
    exp: nowSec + RECEIPT_TTL_SEC,
    serverTime: nowSec,
    licenseValidTo: licenseValidTo(tenant, pool),
    plan: pool.plan,
    ...(config.minVersion ? { minVersion: config.minVersion } : {}),
    ...(config.endpointsVer !== undefined ? { endpointsVer: config.endpointsVer } : {}),
    ...(config.revoked?.length ? { revoked: config.revoked } : {}),
  };
  await db.recordReceipt({
    entryId: entry.id,
    installId,
    kid: keys.kid,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  });
  return signReceipt(payload, keys);
}

export interface ServerConfig {
  minVersion?: Record<string, string>;
  endpointsVer?: number;
  revoked?: string[];
}

export async function login(
  db: Db,
  pepper: string,
  keys: SigningKeyPair,
  input: LoginInput,
  newId: () => string,
  config: ServerConfig = {},
): Promise<LoginResult> {
  const emailHash = await hashEmail(pepper, input.email);
  const netHash = await hashNet(pepper, input.ip);
  const emailKey = `email:${emailHash}`;
  const netKey = `net:${netHash}`;
  const since = input.nowSec - RATE_WINDOW_SEC;

  // Ratebegrensning FØR verifisering — også riktige svar avvises når
  // vinduet er brukt opp, ellers kan en angriper telle seg fram.
  if (
    (await db.countAttempts(emailKey, since)) >= MAX_ATTEMPTS_PER_EMAIL ||
    (await db.countAttempts(netKey, since)) >= MAX_ATTEMPTS_PER_NET
  ) {
    return { ok: false, reason: "for-mange-forsok" };
  }
  await db.recordAttempt(emailKey, input.nowSec);
  await db.recordAttempt(netKey, input.nowSec);

  if (await db.isDenied(emailHash)) return { ok: false, reason: "stengt" };

  const code = normalizeLicenseCode(input.code);
  if (!isValidCodeFormat(code)) return { ok: false, reason: "feil-kode" };

  const codeHash = await hashCode(pepper, input.email, code);
  const entries = await db.findEntriesByEmailHash(emailHash);
  const entry = entries.find((e) => e.codeHash === codeHash);
  if (!entry) return { ok: false, reason: "feil-kode" };
  if (entry.status !== "aktiv") return { ok: false, reason: "stengt" };

  const pool = await findActivePoolAndTenant(db, entry, input.nowSec);
  if (!pool) return { ok: false, reason: "utenfor-periode" };
  const tenant = await db.getTenant(pool.tenantId);

  const installId = newId();
  const installSecret = generateInstallSecret();
  await db.createInstall({
    id: installId,
    entryId: entry.id,
    secretHash: await hashInstallSecret(pepper, installSecret),
    product: input.product,
    version: input.version ?? null,
    lastSeenAt: input.nowSec,
  });
  await db.touchEntry(entry.id, input.nowSec);
  await db.clearAttempts(emailKey);
  await db.recordNet(entry.id, dayOf(input.nowSec), netHash);
  await db.audit("system", "login", { entry: entry.id, install: installId, product: input.product });

  const receipt = await issueReceipt(db, keys, entry, pool, tenant!, installId, input.nowSec, config);
  return { ok: true, receipt, installId, installSecret };
}

export interface RefreshInput {
  installId: string;
  installSecret: string;
  product: string;
  version?: string;
  ip: string;
  nowSec: number;
}

export type RefreshResult =
  | { ok: true; receipt: string }
  | { ok: false; reason: "ukjent-installasjon" | "stengt" | "utenfor-periode" };

/**
 * Døgnlig bakgrunnsfornyelse: glidende utløp — hvert vellykket kall gir
 * en fersk kvittering med nye 100 dager. Stengt konto avvises her, og
 * klienten går i degradert modus når den gamle kvitteringen løper ut.
 */
export async function refresh(
  db: Db,
  pepper: string,
  keys: SigningKeyPair,
  input: RefreshInput,
  config: ServerConfig = {},
): Promise<RefreshResult> {
  const install = await db.getInstall(input.installId);
  if (!install) return { ok: false, reason: "ukjent-installasjon" };

  const secretHash = await hashInstallSecret(pepper, input.installSecret);
  if (secretHash !== install.secretHash) return { ok: false, reason: "ukjent-installasjon" };

  const entry = await db.getEntry(install.entryId);
  if (!entry || entry.status !== "aktiv") return { ok: false, reason: "stengt" };
  if (await db.isDenied(entry.emailHash)) return { ok: false, reason: "stengt" };

  const pool = await findActivePoolAndTenant(db, entry, input.nowSec);
  if (!pool) return { ok: false, reason: "utenfor-periode" };
  const tenant = await db.getTenant(pool.tenantId);

  await db.touchInstall(install.id, input.version ?? null, input.nowSec);
  await db.touchEntry(entry.id, input.nowSec);
  await db.recordNet(entry.id, dayOf(input.nowSec), await hashNet(pepper, input.ip));

  const receipt = await issueReceipt(db, keys, entry, pool, tenant!, install.id, input.nowSec, config);
  return { ok: true, receipt };
}

/** Superadmin: steng en konto. Håndhevingen skjer ved neste fornyelse. */
export async function closeEntry(db: Db, entryId: string, reason: string): Promise<void> {
  await db.setEntryStatus(entryId, "stengt");
  await db.audit("superadmin", "steng", { entry: entryId, grunn: reason });
}

export function dayOf(nowSec: number): string {
  return new Date(nowSec * 1000).toISOString().slice(0, 10);
}
