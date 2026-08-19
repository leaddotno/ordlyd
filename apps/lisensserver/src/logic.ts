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
import type { AktorType, Db, LicensePool, PoolEntry, Tenant } from "./types.js";

/**
 * Speiler rettighetene mellom nettleserbutikkene.
 *
 * Lisenspoolene ble opprettet før Chrome kom til, og har derfor bare
 * `edge-extension`. En Chrome-bygget klient spør etter
 * `chrome-extension` og ville funnet ingenting — altså en bruker med
 * gyldig lisens uten funksjoner.
 *
 * Vi kunne migrert alle poolene, men rettighetene er de SAMME uansett
 * butikk: en lisens bryr seg ikke om hvor utvidelsen ble lastet ned.
 * Derfor speiles nøkkelen når kvitteringen bygges, og ingen pool må
 * røres — hverken de som finnes i dag eller de en kundeadmin lager i
 * morgen.
 *
 * Andre produkter (win-desktop) berøres ikke.
 */
const NETTLESERPAR = ["edge-extension", "chrome-extension"] as const;

export function medButikkalias(
  products: Record<string, { features: string[] }>,
): Record<string, { features: string[] }> {
  const [edge, chrome] = NETTLESERPAR;
  const ut = { ...products };
  if (ut[edge] && !ut[chrome]) ut[chrome] = ut[edge];
  else if (ut[chrome] && !ut[edge]) ut[edge] = ut[chrome];
  return ut;
}

export const ISSUER = "https://lisens.ordlyd.no";

/** Ratebegrensning: maks forsøk per nøkkel innenfor vinduet. */
export const RATE_WINDOW_SEC = 15 * 60;
export const MAX_ATTEMPTS_PER_EMAIL = 5;
export const MAX_ATTEMPTS_PER_NET = 20;

export interface ImportResult {
  /** Nye lisenser med kode i klartekst — engangs-eksporten. */
  imported: Array<{ email: string; code: string }>;
  /**
   * Flyttet fra en prøvepool. Disse har IKKE ny kode: brukeren beholder den
   * hun har, og utvidelsen fortsetter å virke uten at hun gjør noe.
   */
  moved: Array<{ email: string; fraPool: string }>;
  /** Ligger allerede hos en annen navngitt kunde — flyttes ikke automatisk. */
  claimedElsewhere: Array<{ email: string; hosKunde: string }>;
  /** Ugyldig adresse, duplikat i lista, eller alt i denne poolen. */
  skipped: string[];
}

/**
 * Importerer e-postadresser til en pool.
 *
 * Tre utfall per adresse, og skillet mellom dem er hele poenget:
 *
 *  - **Ny** → lisens opprettes, kode returneres i engangs-eksporten.
 *  - **Ligger i en prøvepool** → lisensen FLYTTES. Samme rad, samme
 *    kodehash, ny pool. Brukeren merker ingenting; ved neste døgnlige
 *    fornying får hun den nye poolens rettigheter og gyldighet.
 *  - **Ligger hos en annen navngitt kunde** → røres ikke, men rapporteres.
 *    Automatisk flytting her ville latt én kommune hente brukere fra en
 *    annen bare ved å importere adressene deres.
 */
/**
 * Hvem som utfører importen. Valgfri, slik at testene kan kalle
 * funksjonen uten en innlogget bruker — da føres den som systemhandling.
 */
export interface Aktor {
  actor: string;
  actorId: string | null;
  actorKind: AktorType;
  tenantId: string | null;
}

const SYSTEM: Aktor = { actor: "system", actorId: null, actorKind: "system", tenantId: null };

export async function importEntries(
  db: Db,
  pepper: string,
  poolId: string,
  emails: string[],
  newId: () => string,
  aktor: Aktor = SYSTEM,
): Promise<ImportResult> {
  const pool = await db.getPool(poolId);
  if (!pool) throw new Error(`ukjent pool ${poolId}`);

  const imported: ImportResult["imported"] = [];
  const moved: ImportResult["moved"] = [];
  const claimedElsewhere: ImportResult["claimedElsewhere"] = [];
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

    // Ligger den i en prøvepool? Da flytter vi den hit.
    let flyttet = false;
    for (const e of existing) {
      const fra = await db.getPool(e.poolId);
      if (fra?.plan !== "prove") continue;
      // Prøveperiodens sluttdato skal ikke følge med til en varig lisens.
      await db.moveEntry(e.id, poolId, null);
      await db.audit(aktor.actor, "flytt-lisens", {
        entry: e.id,
        fra_pool: e.poolId,
        til_pool: poolId,
        grunn: "importert til ny pool fra prøvelisens",
      }, { actorId: aktor.actorId, actorKind: aktor.actorKind, tenantId: aktor.tenantId });
      moved.push({ email, fraPool: fra.name });
      flyttet = true;
      break;
    }
    if (flyttet) continue;

    if (existing.length > 0) {
      const annen = await db.getPool(existing[0].poolId);
      const kunde = annen ? await db.getTenant(annen.tenantId) : null;
      claimedElsewhere.push({ email, hosKunde: kunde?.name ?? "ukjent kunde" });
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
      validTo: null,
      source: "import",
    });
    imported.push({ email, code });
  }

  await db.audit(aktor.actor, "import", {
    poolId,
    nye: imported.length,
    flyttet: moved.length,
    hos_annen_kunde: claimedElsewhere.length,
    hoppet_over: skipped.length,
  }, { actorId: aktor.actorId, actorKind: aktor.actorKind, tenantId: aktor.tenantId });
  return { imported, moved, claimedElsewhere, skipped };
}

/* ============================ Selvregistrering ============================ */

export const REG_WINDOW_SEC = 24 * 3600;
export const MAX_REG_PER_EMAIL = 3;
export const REG_NET_WINDOW_SEC = 3600;
export const MAX_REG_PER_NET = 20;

export interface RegistrerInput {
  email: string;
  ip: string;
  nowSec: number;
}

/**
 * Hva som faktisk skjedde. Merk at endepunktet ALDRI skal la utfallet lekke
 * ut til den som registrerer seg — se kommentaren i api/v1/registrer.ts.
 */
export type RegistrerUtfall =
  | { slag: "ny"; code: string; validTo: number | null }
  | { slag: "fornyet"; code: string; validTo: number | null }
  | { slag: "gjenopprettet"; code: string; validTo: number | null; pool: string }
  | { slag: "utlopt-uten-fornyelse"; validTo: number | null }
  | { slag: "stengt" }
  | { slag: "for-mange-forsok" }
  | { slag: "registrering-lukket" }
  | { slag: "ingen-provepool" };

export interface Innstillinger {
  registreringApen: boolean;
  proveDager: number;
  proveFornyelseTillatt: boolean;
  provePoolId: string | null;
}

export async function lesInnstillinger(db: Db): Promise<Innstillinger> {
  const s = await db.getSettings();
  const tall = (v: unknown, standard: number): number => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : standard;
  };
  return {
    registreringApen: s.registrering_apen !== false,
    proveDager: tall(s.prove_dager, 60),
    proveFornyelseTillatt: s.prove_fornyelse_tillatt !== false,
    provePoolId: typeof s.prove_pool_id === "string" ? s.prove_pool_id : null,
  };
}

/**
 * Selvregistrering av prøvelisens — og samtidig gjenoppretting av mistet kode.
 *
 * At de to er samme handling er ikke tilfeldig: vi lagrer bare hashen av
 * koden, så en glemt kode kan ikke sendes på nytt. Den må erstattes. Da er
 * det bedre at brukeren kan gjøre det selv enn at det blir en supportsak.
 *
 * Har adressen allerede en varig lisens hos en kunde, får hun en fersk kode
 * til DEN lisensen — ikke en prøvelisens. Det ville vært et nedgradering.
 */
export async function registrer(
  db: Db,
  pepper: string,
  input: RegistrerInput,
  newId: () => string,
): Promise<RegistrerUtfall> {
  const innst = await lesInnstillinger(db);
  if (!innst.registreringApen) return { slag: "registrering-lukket" };

  const emailHash = await hashEmail(pepper, input.email);
  const netHash = await hashNet(pepper, input.ip);
  const emailKey = `reg:${emailHash}`;
  const netKey = `reg-net:${netHash}`;

  // Ratebegrensning før alt annet, så endepunktet ikke kan brukes til å
  // sende gjentatte e-poster til en adresse brukeren ikke eier.
  if (
    (await db.countAttempts(emailKey, input.nowSec - REG_WINDOW_SEC)) >= MAX_REG_PER_EMAIL ||
    (await db.countAttempts(netKey, input.nowSec - REG_NET_WINDOW_SEC)) >= MAX_REG_PER_NET
  ) {
    return { slag: "for-mange-forsok" };
  }
  await db.recordAttempt(emailKey, input.nowSec);
  await db.recordAttempt(netKey, input.nowSec);

  if (await db.isDenied(emailHash)) return { slag: "stengt" };

  const nyKode = generateLicenseCode();
  const kodeHash = await hashCode(pepper, input.email, nyKode);
  const existing = await db.findEntriesByEmailHash(emailHash);

  // Finnes en varig lisens hos en kunde? Gi ny kode til den.
  for (const e of existing) {
    const pool = await db.getPool(e.poolId);
    if (!pool || pool.plan === "prove") continue;
    if (e.status !== "aktiv") return { slag: "stengt" };
    await db.setEntryCode(e.id, kodeHash, e.validTo);
    await db.audit("system", "ny-kode", { entry: e.id, grunn: "selvbetjent gjenoppretting" });
    return { slag: "gjenopprettet", code: nyKode, validTo: e.validTo, pool: pool.name };
  }

  // Finnes en prøvelisens? Ny kode, og eventuelt ny periode.
  const proveEntry = await førstePrøvelisens(db, existing);
  if (proveEntry) {
    if (proveEntry.status !== "aktiv") return { slag: "stengt" };
    const utlopt = proveEntry.validTo !== null && input.nowSec > proveEntry.validTo;
    if (utlopt && !innst.proveFornyelseTillatt) {
      return { slag: "utlopt-uten-fornyelse", validTo: proveEntry.validTo };
    }
    const nyValidTo = utlopt ? input.nowSec + innst.proveDager * 86_400 : proveEntry.validTo;
    await db.setEntryCode(proveEntry.id, kodeHash, nyValidTo);
    await db.audit("system", utlopt ? "fornyet-prove" : "ny-kode", {
      entry: proveEntry.id,
      dager: utlopt ? innst.proveDager : undefined,
    });
    return { slag: "fornyet", code: nyKode, validTo: nyValidTo };
  }

  // Helt ny bruker.
  if (!innst.provePoolId) return { slag: "ingen-provepool" };
  const validTo = input.nowSec + innst.proveDager * 86_400;
  const id = newId();
  await db.createEntry({
    id,
    poolId: innst.provePoolId,
    emailHash,
    emailMasked: maskEmail(input.email),
    codeHash: kodeHash,
    status: "aktiv",
    lastUsedAt: null,
    validTo,
    source: "selvregistrert",
  });
  await db.audit("system", "selvregistrert", { entry: id, dager: innst.proveDager });
  return { slag: "ny", code: nyKode, validTo };
}

async function førstePrøvelisens(db: Db, entries: PoolEntry[]): Promise<PoolEntry | null> {
  for (const e of entries) {
    const pool = await db.getPool(e.poolId);
    if (pool?.plan === "prove") return e;
  }
  return null;
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
  // Den enkelte lisensens sluttdato — en utløpt prøveperiode gir ingen ny
  // kvittering. Klienten beholder den hun har til den løper ut, og går da i
  // degradert modus; opplesingen fortsetter å virke.
  if (entry.validTo !== null && nowSec > entry.validTo) return null;
  const pool = await db.getPool(entry.poolId);
  if (!pool || pool.status !== "aktiv") return null;
  if (pool.validTo !== null && nowSec > pool.validTo) return null;
  const tenant = await db.getTenant(pool.tenantId);
  if (!tenant || tenant.status !== "aktiv") return null;
  if (tenant.validTo !== null && nowSec > tenant.validTo) return null;
  return pool;
}

/**
 * Når slutter lisensen å gjelde? Den strengeste av kundens, poolens og den
 * enkelte lisensens sluttdato. Null betyr løpende — det vanlige, og det som
 * gjør at klienten kan slutte å vise en nedtelling som ikke betyr noe.
 *
 * Den tredje datoen er det som gjør prøvelisenser mulige: hver bruker får
 * sine 60 dager fra sin egen registrering, ikke fra en felles dato.
 */
function licenseValidTo(tenant: Tenant, pool: LicensePool, entry: PoolEntry): number | null {
  const datoer = [tenant.validTo, pool.validTo, entry.validTo].filter(
    (v): v is number => v !== null,
  );
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
    products: medButikkalias(pool.products),
    iat: nowSec,
    softExp: nowSec + RECEIPT_SOFT_TTL_SEC,
    exp: nowSec + RECEIPT_TTL_SEC,
    serverTime: nowSec,
    licenseValidTo: licenseValidTo(tenant, pool, entry),
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
