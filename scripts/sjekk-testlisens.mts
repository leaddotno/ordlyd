/**
 * Kontrollerer at testlisensen for Microsofts sertifisering virker.
 *
 * Butikkpolicy 1.3.1 krever at vi oppgir en fungerende testlisens i «Notes
 * for certification». Blir den stengt eller slutter å virke midt i
 * gjennomgangen, feiler sertifiseringen på noe som er trivielt å sjekke.
 * Kjør denne før hver innsending.
 *
 * Kjør: pnpm exec tsx scripts/sjekk-testlisens.mts <e-post> <kode>
 */
import { LicenseClient, type LicenseStorage, type StoredLicense } from "../packages/license-client/src/index.js";
import { TRUSTED_KEYS, PRODUCT, BASE_URLS } from "../apps/extension/src/license-config.js";

const epost = process.argv[2] ?? "edge-review@ordlyd.no";
const kode = (process.argv[3] ?? "").replace(/\D/g, "");

if (!kode) {
  console.error("Bruk: pnpm exec tsx scripts/sjekk-testlisens.mts <e-post> <kode>");
  process.exit(2);
}

class MinneLager implements LicenseStorage {
  value: StoredLicense | null = null;
  async read() { return this.value; }
  async write(v: StoredLicense) { this.value = { ...v }; }
  async clear() { this.value = null; }
}

const klient = new LicenseClient({
  baseUrls: BASE_URLS,
  trustedKeys: TRUSTED_KEYS,
  product: PRODUCT,
  version: "1.0.0",
  storage: new MinneLager(),
});

let feil = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

console.log(`Tester ${epost} mot ${BASE_URLS[0]}\n`);

const inn = await klient.login(epost, kode);
sjekk("innlogging lykkes", inn.ok, inn);
if (!inn.ok) process.exit(1);

const s = await klient.state();
sjekk("lisensen er aktiv", s.status === "aktiv", s.status);
sjekk("lisensen er løpende, uten sluttdato som kan gå ut midt i gjennomgangen", s.lisensSlutt === null, s.lisensSlutt);
sjekk("alle fem funksjoner er tillatt", s.funksjoner.length === 5, s.funksjoner);
sjekk("fornying virker", await klient.refresh(true));

console.log(
  feil === 0
    ? "\nTestlisensen er klar til å oppgis i «Notes for certification»."
    : `\n${feil} sjekk(er) feilet — ikke send inn før dette er rettet.`,
);
process.exit(feil === 0 ? 0 : 1);
