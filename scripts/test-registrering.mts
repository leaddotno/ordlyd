/**
 * Tester selvregistrering og flytting mellom pooler — uten nettverk.
 * Kjør: pnpm exec tsx scripts/test-registrering.mts
 *
 * Den viktigste testen her er at kodehashen er UENDRET etter en flytting.
 * Det er hele løftet om sømløs overgang: brukerens kode og den installerte
 * utvidelsen skal fortsette å virke når hun går fra prøve til kommune.
 */
import {
  generateSigningKeys,
  exportPublicJwks,
  importVerifyKeys,
  verifyReceipt,
  hashEmail,
  formatLicenseCode,
  isValidCodeFormat,
} from "../packages/license-core/src/index.js";
import { MemoryDb } from "../apps/lisensserver/src/db-memory.js";
import { importEntries, registrer, login, lesInnstillinger, MAX_REG_PER_EMAIL } from "../apps/lisensserver/src/logic.js";
import { velkomstEpost } from "../apps/lisensserver/src/epost.js";

let feil = 0;
let n = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

const P = "pepper-for-test";
const NOW = 1_786_600_000;
const DAG = 86_400;
const ALLE = ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"];

const keys = await generateSigningKeys("sk-test");
const trusted = [await importVerifyKeys(await exportPublicJwks(keys))];

/** Fersk base med prøvepool og én kundepool. */
async function nyBase() {
  const db = new MemoryDb();
  let i = 0;
  const newId = () => `id-${++i}`;

  await db.createTenant({ id: "t-prove", slug: "ordlyd-prove", name: "Ordlyd prøvelisenser", status: "aktiv", validTo: null });
  await db.createPool({
    id: "p-prove", tenantId: "t-prove", name: "Prøvelisens", status: "aktiv", validTo: null,
    plan: "prove", products: { "edge-extension": { features: ALLE } },
  });
  await db.createTenant({ id: "t-dn", slug: "dysleksi-norge", name: "Dysleksi Norge", status: "aktiv", validTo: null });
  await db.createPool({
    id: "p-dn", tenantId: "t-dn", name: "Medlemmer", status: "aktiv", validTo: null,
    plan: "medlem", products: { "edge-extension": { features: ALLE } },
  });
  await db.setSetting("prove_pool_id", "p-prove");
  return { db, newId };
}

/* ---------- Innstillinger ---------- */
console.log("— Innstillinger —");
{
  const { db } = await nyBase();
  const i = await lesInnstillinger(db);
  sjekk("standard prøveperiode er 60 dager", i.proveDager === 60, i.proveDager);
  sjekk("registrering er åpen som standard", i.registreringApen);
  sjekk("fornyelse er tillatt som standard", i.proveFornyelseTillatt);

  await db.setSetting("prove_dager", 300);
  await db.setSetting("prove_fornyelse_tillatt", false);
  await db.setSetting("registrering_apen", false);
  const j = await lesInnstillinger(db);
  sjekk("prøveperioden kan settes til 300 dager", j.proveDager === 300, j.proveDager);
  sjekk("fornyelse kan skrus av", !j.proveFornyelseTillatt);
  sjekk("registrering kan stenges", !j.registreringApen);

  await db.setSetting("prove_dager", "10");
  sjekk("tallverdi som tekst tolkes riktig", (await lesInnstillinger(db)).proveDager === 10);
  await db.setSetting("prove_dager", -5);
  sjekk("ugyldig verdi faller tilbake til 60", (await lesInnstillinger(db)).proveDager === 60);
}

/* ---------- Ny registrering ---------- */
console.log("\n— Ny registrering —");
{
  const { db, newId } = await nyBase();
  const r = await registrer(db, P, { email: "Kari@Eksempel.no", ip: "88.1.2.3", nowSec: NOW }, newId);
  sjekk("ny bruker får prøvelisens", r.slag === "ny", r);
  if (r.slag !== "ny") process.exit(1);
  sjekk("koden har riktig format", isValidCodeFormat(r.code), r.code);
  sjekk("gyldig i 60 dager", r.validTo === NOW + 60 * DAG, r.validTo);

  const entry = [...db.entries.values()][0];
  sjekk("lisensen ligger i prøvepoolen", entry.poolId === "p-prove", entry.poolId);
  sjekk("kilden er merket selvregistrert", entry.source === "selvregistrert", entry.source);
  sjekk("e-posten lagres bare maskert og som hash", entry.emailMasked === "k***@eksempel.no" && !JSON.stringify(entry).includes("kari@eksempel.no"));

  // Koden må faktisk virke
  const inn = await login(db, P, keys, {
    email: "kari@eksempel.no", code: r.code, product: "edge-extension", ip: "88.1.2.3", nowSec: NOW,
  }, newId);
  sjekk("den nye koden logger inn", inn.ok, inn);
  if (inn.ok) {
    const v = await verifyReceipt(inn.receipt, trusted, NOW);
    sjekk("kvitteringen bærer prøveperiodens sluttdato", v.payload?.licenseValidTo === NOW + 60 * DAG, v.payload?.licenseValidTo);
    sjekk("kvitteringen sier lisenstype prove", v.payload?.plan === "prove", v.payload?.plan);
  }
}

/* ---------- Re-registrering: gjenoppretting av mistet kode ---------- */
console.log("\n— Mistet kode —");
{
  const { db, newId } = await nyBase();
  const a = await registrer(db, P, { email: "ola@eksempel.no", ip: "10.0.0.1", nowSec: NOW }, newId);
  const b = await registrer(db, P, { email: "ola@eksempel.no", ip: "10.0.0.1", nowSec: NOW + 3600 }, newId);
  sjekk("andre registrering gir ny kode", b.slag === "fornyet", b);
  if (a.slag !== "ny" || b.slag !== "fornyet") process.exit(1);
  sjekk("den nye koden er en annen enn den gamle", a.code !== b.code);
  sjekk("prøveperioden forlenges IKKE når den ikke er utløpt", b.validTo === a.validTo, { a: a.validTo, b: b.validTo });
  sjekk("bare én lisens finnes fortsatt", db.entries.size === 1, db.entries.size);

  const gammel = await login(db, P, keys, { email: "ola@eksempel.no", code: a.code, product: "edge-extension", ip: "1.1.1.1", nowSec: NOW + 3600 }, newId);
  sjekk("den gamle koden slutter å virke", !gammel.ok);
  const ny = await login(db, P, keys, { email: "ola@eksempel.no", code: b.code, product: "edge-extension", ip: "1.1.1.1", nowSec: NOW + 3600 }, newId);
  sjekk("den nye koden virker", ny.ok);
}

/* ---------- Utløpt prøve ---------- */
console.log("\n— Utløpt prøveperiode —");
{
  const { db, newId } = await nyBase();
  const a = await registrer(db, P, { email: "per@eksempel.no", ip: "10.0.0.2", nowSec: NOW }, newId);
  const etter = NOW + 70 * DAG;

  const utlopt = await login(db, P, keys, { email: "per@eksempel.no", code: (a as any).code, product: "edge-extension", ip: "1.1.1.1", nowSec: etter }, newId);
  sjekk("utløpt prøve gir ikke ny kvittering", !utlopt.ok && utlopt.reason === "utenfor-periode", utlopt);

  const fornyet = await registrer(db, P, { email: "per@eksempel.no", ip: "10.0.0.2", nowSec: etter }, newId);
  sjekk("fornyelse gir ny periode når det er tillatt", fornyet.slag === "fornyet" && fornyet.validTo === etter + 60 * DAG, fornyet);

  // Med fornyelse avslått
  await db.setSetting("prove_fornyelse_tillatt", false);
  const enda = NOW + 200 * DAG;
  const nektet = await registrer(db, P, { email: "per@eksempel.no", ip: "10.0.0.2", nowSec: enda }, newId);
  sjekk("avslått fornyelse gir ingen ny periode", nektet.slag === "utlopt-uten-fornyelse", nektet);
}

/* ---------- Flytting fra prøve til kunde: SØMLØSHETEN ---------- */
console.log("\n— Flytting fra prøvelisens til kunde —");
{
  const { db, newId } = await nyBase();
  const reg = await registrer(db, P, { email: "elev@skole.no", ip: "10.0.0.3", nowSec: NOW }, newId);
  if (reg.slag !== "ny") process.exit(1);

  const før = [...db.entries.values()][0];
  const kodeHashFør = før.codeHash;
  const entryIdFør = før.id;

  // Eleven aktiverer på en maskin
  const inn = await login(db, P, keys, { email: "elev@skole.no", code: reg.code, product: "edge-extension", ip: "10.0.0.3", nowSec: NOW }, newId);
  sjekk("eleven aktiverer med prøvekoden", inn.ok);
  if (!inn.ok) process.exit(1);

  // Dysleksi Norge importerer samme adresse
  const imp = await importEntries(db, P, "p-dn", ["elev@skole.no"], newId);
  sjekk("importen rapporterer den som flyttet, ikke ny", imp.moved.length === 1 && imp.imported.length === 0, {
    flyttet: imp.moved, nye: imp.imported.length,
  });
  sjekk("flyttingen oppgir hvilken pool den kom fra", imp.moved[0]?.fraPool === "Prøvelisens", imp.moved[0]);

  const etter = [...db.entries.values()][0];
  sjekk("SAMME rad — ingen dublett opprettet", db.entries.size === 1 && etter.id === entryIdFør, { antall: db.entries.size });
  sjekk("KODEHASHEN ER UENDRET — brukerens kode virker fortsatt", etter.codeHash === kodeHashFør);
  sjekk("lisensen ligger nå hos Dysleksi Norge", etter.poolId === "p-dn", etter.poolId);
  sjekk("prøveperiodens sluttdato er fjernet", etter.validTo === null, etter.validTo);

  // Det avgjørende: den gamle koden virker fortsatt, og installasjonen fornyer seg
  const fortsatt = await login(db, P, keys, { email: "elev@skole.no", code: reg.code, product: "edge-extension", ip: "10.0.0.3", nowSec: NOW + DAG }, newId);
  sjekk("den opprinnelige koden virker etter flyttingen", fortsatt.ok, fortsatt);

  const { refresh } = await import("../apps/lisensserver/src/logic.js");
  const forny = await refresh(db, P, keys, {
    installId: inn.installId, installSecret: inn.installSecret, product: "edge-extension", ip: "10.0.0.3", nowSec: NOW + 100 * DAG,
  });
  sjekk("installasjonen fornyer seg selv etter at prøven ville utløpt", forny.ok, forny);
  if (forny.ok) {
    const v = await verifyReceipt(forny.receipt, trusted, NOW + 100 * DAG);
    sjekk("den nye kvitteringen er løpende, ikke tidsbegrenset", v.payload?.licenseValidTo === null, v.payload?.licenseValidTo);
    sjekk("lisenstypen er oppdatert til medlem", v.payload?.plan === "medlem", v.payload?.plan);
  }
}

/* ---------- Sikkerhetsgrense: ikke stjel brukere mellom kunder ---------- */
console.log("\n— Grensen mellom kunder —");
{
  const { db, newId } = await nyBase();
  await db.createTenant({ id: "t-kom", slug: "en-kommune", name: "En kommune", status: "aktiv", validTo: null });
  await db.createPool({
    id: "p-kom", tenantId: "t-kom", name: "Elever", status: "aktiv", validTo: null,
    plan: "skole", products: { "edge-extension": { features: ALLE } },
  });

  const imp1 = await importEntries(db, P, "p-dn", ["felles@eksempel.no"], newId);
  sjekk("første import oppretter lisensen", imp1.imported.length === 1);
  const eier = [...db.entries.values()][0].poolId;

  const imp2 = await importEntries(db, P, "p-kom", ["felles@eksempel.no"], newId);
  sjekk("annen kunde får IKKE flytte den automatisk", imp2.moved.length === 0 && imp2.imported.length === 0, imp2);
  sjekk("den rapporteres som opptatt, med kundenavn", imp2.claimedElsewhere[0]?.hosKunde === "Dysleksi Norge", imp2.claimedElsewhere);
  sjekk("lisensen står urørt hos opprinnelig kunde", [...db.entries.values()][0].poolId === eier);
}

/* ---------- Varig lisens: registrering gir kode til DEN, ikke en prøve ---------- */
console.log("\n— Registrering når man alt har varig lisens —");
{
  const { db, newId } = await nyBase();
  await importEntries(db, P, "p-dn", ["medlem@eksempel.no"], newId);
  const r = await registrer(db, P, { email: "medlem@eksempel.no", ip: "10.0.0.4", nowSec: NOW }, newId);
  sjekk("utfallet er gjenoppretting, ikke ny prøve", r.slag === "gjenopprettet", r);
  if (r.slag === "gjenopprettet") {
    sjekk("den oppgir hvilken pool lisensen hører til", r.pool === "Medlemmer", r.pool);
    sjekk("lisensen er fortsatt løpende — ingen nedgradering", r.validTo === null, r.validTo);
  }
  sjekk("ingen prøvelisens ble opprettet", db.entries.size === 1, db.entries.size);
  sjekk("lisensen ligger fortsatt hos kunden", [...db.entries.values()][0].poolId === "p-dn");
}

/* ---------- Ratebegrensning ---------- */
console.log("\n— Ratebegrensning —");
{
  const { db, newId } = await nyBase();
  for (let i = 0; i < MAX_REG_PER_EMAIL; i++) {
    await registrer(db, P, { email: "spam@eksempel.no", ip: "9.9.9.9", nowSec: NOW + i }, newId);
  }
  const stoppet = await registrer(db, P, { email: "spam@eksempel.no", ip: "9.9.9.9", nowSec: NOW + 10 }, newId);
  sjekk("for mange registreringer på samme adresse stoppes", stoppet.slag === "for-mange-forsok", stoppet);

  const senere = await registrer(db, P, { email: "spam@eksempel.no", ip: "9.9.9.9", nowSec: NOW + 25 * 3600 }, newId);
  sjekk("…og slipper gjennom etter et døgn", senere.slag === "fornyet", senere);
}

/* ---------- Stengt registrering ---------- */
console.log("\n— Stengt registrering —");
{
  const { db, newId } = await nyBase();
  await db.setSetting("registrering_apen", false);
  const r = await registrer(db, P, { email: "ny@eksempel.no", ip: "1.2.3.4", nowSec: NOW }, newId);
  sjekk("stengt registrering avvises før noe opprettes", r.slag === "registrering-lukket" && db.entries.size === 0, r);
}

/* ---------- E-postinnholdet ---------- */
console.log("\n— Velkomst-e-posten —");
{
  const e = velkomstEpost({ kode: "3954388", validTo: NOW + 60 * DAG, slag: "ny" });
  sjekk("koden vises gruppert i teksten", e.tekst.includes("395 4388"), formatLicenseCode("3954388"));
  sjekk("koden vises gruppert i HTML-en", e.html.includes("395 4388"));
  sjekk("sluttdatoen står i e-posten", e.tekst.includes("2026"));
  sjekk("emnet forteller hva det er", e.emne.includes("lisenskode"), e.emne);
  sjekk("ren tekst finnes for klienter uten HTML", e.tekst.length > 200);

  const l = velkomstEpost({ kode: "1112223", validTo: null, slag: "gjenopprettet", pool: "Medlemmer" });
  sjekk("løpende lisens sier ingen sluttdato", l.tekst.includes("løpende") || l.tekst.includes("ingen sluttdato"), l.tekst.slice(0, 120));
  sjekk("gjenoppretting nevner at gammel kode slutter å virke", l.tekst.includes("slutter å virke"));
}

console.log(feil === 0 ? `\nALLE OK (${n} tester)` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
