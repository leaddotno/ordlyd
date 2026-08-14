/**
 * Domenetyper og databasegrensesnittet for lisensserveren.
 *
 * Logikken i logic.ts kjenner BARE dette grensesnittet. I test brukes
 * MemoryDb (db-memory.ts); i produksjon en Postgres-implementasjon mot
 * Supabase. Skjemaet ligger i supabase/migrations/.
 */

export type TenantStatus = "aktiv" | "suspendert" | "avsluttet";
export type EntryStatus = "aktiv" | "stengt";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  /** Unix-sekunder; null = ingen sluttdato */
  validTo: number | null;
}

export type LicensePlan = "medlem" | "skole" | "prove" | "apen";

export interface LicensePool {
  id: string;
  tenantId: string;
  name: string;
  status: "aktiv" | "stengt";
  validTo: number | null;
  /** Lisenstype — følger med i kvitteringen og forklares i «Om Ordlyd». */
  plan: LicensePlan;
  /** {"edge-extension": {"features": ["tts", …]}} — kopieres inn i kvitteringen */
  products: Record<string, { features: string[] }>;
}

export type EntrySource = "import" | "selvregistrert";

export interface PoolEntry {
  id: string;
  poolId: string;
  emailHash: string;
  emailMasked: string;
  codeHash: string;
  status: EntryStatus;
  lastUsedAt: number | null;
  /** Sluttdato for denne ene lisensen. null = følger poolens og kundens datoer. */
  validTo: number | null;
  source: EntrySource;
}

export interface Install {
  id: string;
  entryId: string;
  secretHash: string;
  product: string;
  version: string | null;
  lastSeenAt: number | null;
}

export interface Db {
  getTenant(id: string): Promise<Tenant | null>;
  getPool(id: string): Promise<LicensePool | null>;
  createTenant(t: Tenant): Promise<void>;
  createPool(p: LicensePool): Promise<void>;

  createEntry(e: PoolEntry): Promise<void>;
  /** Alle oppføringer med denne e-posthashen, på tvers av pooler. */
  findEntriesByEmailHash(emailHash: string): Promise<PoolEntry[]>;
  getEntry(id: string): Promise<PoolEntry | null>;
  setEntryStatus(id: string, status: EntryStatus): Promise<void>;
  touchEntry(id: string, nowSec: number): Promise<void>;
  isDenied(emailHash: string): Promise<boolean>;

  /**
   * Flytter lisensen til en annen pool. **Kodehashen røres ikke** — det er
   * hele poenget: brukerens kode og den installerte utvidelsen fortsetter å
   * virke, og neste fornying plukker opp den nye poolens rettigheter.
   */
  moveEntry(id: string, newPoolId: string, newValidTo: number | null): Promise<void>;

  /** Ny kode på en eksisterende lisens — brukes ved re-registrering. */
  setEntryCode(id: string, codeHash: string, validTo: number | null): Promise<void>;

  /** Innstillinger som endres i drift, uten ny utrulling. */
  getSettings(): Promise<Record<string, unknown>>;
  setSetting(key: string, value: unknown): Promise<void>;

  createInstall(i: Install): Promise<void>;
  getInstall(id: string): Promise<Install | null>;
  touchInstall(id: string, version: string | null, nowSec: number): Promise<void>;

  /** Ratebegrensning: antall forsøk for nøkkelen i vinduet, og registrering av et nytt. */
  countAttempts(key: string, sinceSec: number): Promise<number>;
  recordAttempt(key: string, nowSec: number): Promise<void>;
  clearAttempts(key: string): Promise<void>;

  /** Misbrukstellere: registrer pseudonymisert nettnøkkel for døgnet. */
  recordNet(entryId: string, day: string, netHash: string): Promise<void>;
  distinctNets(entryId: string, day: string): Promise<number>;

  /** Revisjonsspor over utstedte kvitteringer (grunnlag for tilbakekalling). */
  recordReceipt(r: {
    entryId: string;
    installId: string;
    kid: string;
    issuedAt: number;
    expiresAt: number;
  }): Promise<void>;

  audit(actor: string, action: string, details: Record<string, unknown>): Promise<void>;
}
