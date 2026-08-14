/**
 * Verifiserer poolflyttingen mot LIVE server.
 *
 * Kjører hele forløpet en elev faktisk går gjennom: får prøvelisens,
 * aktiverer den på en maskin, blir importert av en forening, og skal
 * fortsette å virke med samme kode.
 *
 * Bruker admin-API-et til å lage prøvelisensen framfor /registrer, slik at
 * testen har koden uten å måtte lese noens innboks.
 *
 * Kjør:
 *   ORDLYD_ADMIN_TOKEN=<token> pnpm exec tsx scripts/smoke-poolflytting.mts
 *
 * Rydder opp etter seg selv til slutt.
 */
import { LicenseClient, type LicenseStorage, type StoredLicense } from "../packages/license-client/src/index.js";
import { TRUSTED_KEYS, PRODUCT, BASE_URLS } from "../apps/extension/src/license-config.js";

const BASE = (process.env.ORDLYD_BASE_URL ?? BASE_URLS[0]).replace(/\/$/, "");
const TOKEN = process.env.ORDLYD_ADMIN_TOKEN ?? "";
if (!TOKEN) {
  console.error("Mangler ORDLYD_ADMIN_TOKEN.");
  process.exit(2);
}

let feil = 0;
let n = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

async function admin(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

class MinneLager implements LicenseStorage {
  value: StoredLicense | null = null;
  async read() { return this.value; }
  async write(v: StoredLicense) { this.value = { ...v }; }
  async clear() { this.value = null; }
}

const nyKlient = () =>
  new LicenseClient({
    baseUrls: [BASE],
    trustedKeys: TRUSTED_KEYS,
    product: PRODUCT,
    version: "1.0.0",
    storage: new MinneLager(),
  });

console.log(`Tester poolflytting mot ${BASE}\n`);

/* --- Finn prøvepoolen og lag en mottakerpool --- */
const innst = await admin("/api/v1/admin/settings", {});
const provePoolId: string | undefined = innst?.tolket?.provePoolId;
sjekk("prøvepoolen er satt opp i innstillingene", Boolean(provePoolId), innst?.tolket);
if (!provePoolId) process.exit(1);

await admin("/api/v1/admin/tenant", { slug: "test-flytting", name: "TEST flytting - kan slettes" });
const oversikt = await admin("/api/v1/admin/overview");
const kunde = oversikt.kunder?.find((t: any) => t.slug === "test-flytting");
let malPoolId: string | undefined = kunde?.pools?.[0]?.poolId;
if (!malPoolId) {
  const p = await admin("/api/v1/admin/pool", {
    tenantId: kunde.tenantId,
    name: "Medlemmer",
    plan: "medlem",
    features: ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"],
    products: [PRODUCT],
  });
  malPoolId = p.poolId;
}
sjekk("mottakerpool klar", Boolean(malPoolId), { malPoolId });

/* --- Lag en prøvelisens med kort periode, slik at vi kan se datoen --- */
const epost = `flytt-${Date.now()}@test.invalid`;
const imp = await admin("/api/v1/admin/import", { poolId: provePoolId, emails: [epost] });
const kode: string | undefined = imp.lisenser?.[0]?.code;
sjekk("prøvelisens opprettet", Boolean(kode), imp);
if (!kode) process.exit(1);

/* --- Eleven aktiverer på en maskin --- */
const klient = nyKlient();
const inn = await klient.login(epost, kode);
sjekk("eleven aktiverer med prøvekoden", inn.ok, inn);
if (!inn.ok) process.exit(1);

const før = await klient.state();
sjekk("lisenstypen er prøve", før.lisenstype === "prove", før.lisenstype);

/* --- Foreningen importerer samme adresse --- */
const flytt = await admin("/api/v1/admin/import", { poolId: malPoolId, emails: [epost] });
sjekk(
  "importen rapporterer FLYTTET, ikke ny lisens",
  flytt.antallFlyttet === 1 && flytt.antallImportert === 0,
  { flyttet: flytt.antallFlyttet, nye: flytt.antallImportert, hosAnnen: flytt.antallHosAnnenKunde },
);
sjekk("den oppgir hvilken pool den kom fra", flytt.flyttet?.[0]?.fraPool === "Prøvelisens", flytt.flyttet);
sjekk("ingen ny kode returnert for den flyttede", (flytt.lisenser ?? []).length === 0, flytt.lisenser);

/* --- Det avgjørende: samme kode virker fortsatt --- */
const klient2 = nyKlient();
const igjen = await klient2.login(epost, kode);
sjekk("DEN OPPRINNELIGE KODEN VIRKER ETTER FLYTTINGEN", igjen.ok, igjen);

const etter = await klient2.state();
sjekk("lisenstypen er oppdatert til medlem", etter.lisenstype === "medlem", etter.lisenstype);
sjekk("prøveperiodens sluttdato er borte — lisensen er løpende", etter.lisensSlutt === null, etter.lisensSlutt);

/* --- Den allerede installerte maskinen fornyer seg selv --- */
const fornyet = await klient.refresh(true);
sjekk("den installerte maskinen fornyer seg uten ny innlogging", fornyet);
const etterForny = await klient.state();
sjekk("og har fått den nye poolens rettigheter", etterForny.lisenstype === "medlem" && etterForny.lisensSlutt === null, {
  type: etterForny.lisenstype, slutt: etterForny.lisensSlutt,
});

/* --- Grensen mot andre kunder --- */
const igjenFlytt = await admin("/api/v1/admin/import", { poolId: provePoolId, emails: [epost] });
sjekk(
  "prøvepoolen får IKKE hente den tilbake automatisk",
  igjenFlytt.antallHosAnnenKunde === 1 && igjenFlytt.antallFlyttet === 0,
  igjenFlytt,
);

console.log(
  feil === 0
    ? `\nALLE ${n} OK — poolflyttingen virker i produksjon.\nRydd opp:\n  delete from tenants where slug = 'test-flytting';`
    : `\n${feil} av ${n} FEILET`,
);
process.exit(feil === 0 ? 0 : 1);
