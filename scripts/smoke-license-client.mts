/**
 * Ende-til-ende: lisensKLIENTEN mot en LIVE lisensserver.
 *
 * Forskjellen fra test-license-client.mts (som bruker en simulert server)
 * er at dette kjører den ekte kontrakten: klienten bruker de samme pinnede
 * produksjonsnøklene som utvidelsen, mot en ekte kvittering signert av
 * serveren. Går denne grønt, virker utvidelsens lisensdel også — det er
 * samme kode.
 *
 * Kjør (PowerShell):
 *   $env:ORDLYD_BASE_URL = "https://ordlyd-demo.vercel.app"
 *   $env:ORDLYD_ADMIN_TOKEN = "<ADMIN_TOKEN>"
 *   pnpm exec tsx scripts/smoke-license-client.mts
 *
 * Skriptet lager sin egen testkunde. Rydd opp med:
 *   delete from tenants where slug = 'test-klient';
 */
import { LicenseClient, type LicenseStorage, type StoredLicense } from "../packages/license-client/src/index.js";
import { TRUSTED_KEYS, PRODUCT, BASE_URLS } from "../apps/extension/src/license-config.js";

const BASE = (process.env.ORDLYD_BASE_URL ?? BASE_URLS[0]).replace(/\/$/, "");
const TOKEN = process.env.ORDLYD_ADMIN_TOKEN ?? "";
if (!TOKEN) {
  console.error("Mangler ORDLYD_ADMIN_TOKEN.");
  process.exit(2);
}

let failed = 0;
let n = 0;
const check = (label: string, ok: boolean, detail?: unknown): void => {
  n++;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${label}`);
  if (!ok && detail !== undefined) console.log(`     ${JSON.stringify(detail)}`);
};

async function admin(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

console.log(`Tester klienten mot ${BASE}\n`);

/* Sett opp en testkunde og pool (idempotent) */
await admin("/api/v1/admin/tenant", { slug: "test-klient", name: "TEST klient - kan slettes" });
const oversikt = await admin("/api/v1/admin/overview");
const kunde = oversikt.kunder?.find((t: any) => t.slug === "test-klient");
let poolId: string | undefined = kunde?.pools?.[0]?.poolId;
if (!poolId) {
  const p = await admin("/api/v1/admin/pool", {
    tenantId: kunde.tenantId,
    name: "Klienttest",
    features: ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"],
    products: [PRODUCT],
  });
  poolId = p.poolId;
}
check("testkunde og pool på plass", Boolean(poolId), { poolId });

const epost = `klient-${Date.now()}@test.invalid`;
const imp = await admin("/api/v1/admin/import", { poolId, emails: [epost] });
const kode: string | undefined = imp.lisenser?.[0]?.code;
check("lisens importert og kode generert", Boolean(kode), imp);
if (!kode) process.exit(1);

/* Klienten — samme oppsett som utvidelsen bruker, inkludert pinnede nøkler */
class MinneLager implements LicenseStorage {
  value: StoredLicense | null = null;
  async read() { return this.value; }
  async write(v: StoredLicense) { this.value = { ...v }; }
  async clear() { this.value = null; }
}
const lager = new MinneLager();
const klient = new LicenseClient({
  baseUrls: [BASE],
  trustedKeys: TRUSTED_KEYS,
  product: PRODUCT,
  version: "0.0.1",
  storage: lager,
});

check("uten innlogging: ingen funksjoner tillatt", (await klient.state()).status === "ulisensiert");

const feil = await klient.login(epost, "0000000");
check("feil kode avvises med forståelig beskjed", !feil.ok, feil);

const ok = await klient.login(epost, kode);
check("innlogging mot ekte server lykkes", ok.ok, ok);

const s = await klient.state();
check(
  `produksjonskvittering verifiseres mot pinnet nøkkel (${TRUSTED_KEYS[0].kid}) — ${s.dagerTilKontaktfrist} dager`,
  s.status === "aktiv" && s.dagerTilKontaktfrist !== null && s.dagerTilKontaktfrist >= 99,
  s,
);
check("alle fem funksjoner er tillatt", s.funksjoner.length === 5, s.funksjoner);
check("opplesing er tillatt", await klient.hasFeature("tts"));
check("e-post lagres bare maskert", s.epostMaskert?.includes("***") === true && !JSON.stringify(lager.value).includes(epost), s.epostMaskert);

check("fornyelse lykkes mot ekte server", await klient.refresh(true));

/* Stenging skal slå gjennom ved neste fornyelse — men ikke slette kvitteringen */
const lisenser = await admin(`/api/v1/admin/entries?poolId=${poolId}`);
const entry = lisenser.lisenser?.[0];
await admin("/api/v1/admin/status", { entryId: entry.id, status: "stengt", reason: "klienttest" });

const kvitteringFoer = lager.value!.receipt;
const fornyetEtterStenging = await klient.refresh(true);
const etter = await klient.state();
check("stengt konto: fornyelse avslås", !fornyetEtterStenging);
check("stengt konto: kvitteringen BEHOLDES (offline-løftet)", lager.value!.receipt === kvitteringFoer);
check("stengt konto: lisensen virker til kvitteringen løper ut", etter.status === "aktiv" && etter.funksjoner.length === 5, etter);
check("stengingen vises for brukeren", etter.sisteAvslag === "stengt", etter.sisteAvslag);

console.log(
  failed === 0
    ? `\nALLE ${n} OK — klienten virker mot produksjon.\nRydd opp:\n  delete from tenants where slug = 'test-klient';`
    : `\n${failed} av ${n} FEILET`,
);
process.exit(failed === 0 ? 0 : 1);
