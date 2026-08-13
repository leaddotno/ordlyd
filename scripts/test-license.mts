/**
 * Tester lisenskjernen og serverlogikken.
 * Kjør: pnpm exec tsx scripts/test-license.mts
 */
import {
  generateSigningKeys,
  exportPublicJwks,
  importVerifyKeys,
  signReceipt,
  verifyReceipt,
  hashEmail,
  hashCode,
  maskEmail,
  generateLicenseCode,
  formatLicenseCode,
  normalizeLicenseCode,
  isValidCodeFormat,
  RECEIPT_TTL_SEC,
  RECEIPT_SOFT_TTL_SEC,
  type ReceiptPayload,
} from "../packages/license-core/src/index.js";
import { MemoryDb } from "../apps/lisensserver/src/db-memory.js";
import {
  importEntries,
  login,
  refresh,
  closeEntry,
  MAX_ATTEMPTS_PER_EMAIL,
} from "../apps/lisensserver/src/logic.js";

let failed = 0;
let n = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  n++;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : `  (${detail})`}`);
};

const NOW = 1_786_500_000; // fast "nå" — logikken tar tid som parameter

// ---------- Kvitteringer ----------
console.log("— Kvittering: signering og verifisering —");
const keys = await generateSigningKeys("sk-test");
const jwks = await exportPublicJwks(keys);
const bothKeys = [await importVerifyKeys(jwks)];
const p256Only = [await importVerifyKeys({ kid: jwks.kid, p256: jwks.p256 })];

const payload: ReceiptPayload = {
  v: 1,
  kid: "sk-test",
  iss: "https://lisens.ordlyd.no",
  sub: "code:abc123",
  tenant: "dysleksi-norge",
  install: "inst-1",
  products: { "edge-extension": { features: ["tts", "ordbok"] } },
  iat: NOW,
  softExp: NOW + RECEIPT_SOFT_TTL_SEC,
  exp: NOW + RECEIPT_TTL_SEC,
  serverTime: NOW,
};
const envelope = await signReceipt(payload, keys);

const v1 = await verifyReceipt(envelope, bothKeys, NOW);
check("gyldig kvittering verifiseres (Ed25519)", v1.ok && v1.via === "ed25519" && v1.state === "aktiv", JSON.stringify(v1));

const v2 = await verifyReceipt(envelope, p256Only, NOW);
check("verifiseres med kun P-256 (.NET/eldre Edge-stien)", v2.ok && v2.via === "p256", JSON.stringify(v2));

const parts = envelope.split(".");
const tamperedPayload = [parts[0], parts[1].slice(0, -2) + (parts[1].endsWith("A") ? "BB" : "AA"), parts[2], parts[3]].join(".");
check("manipulert innhold avvises", !(await verifyReceipt(tamperedPayload, bothKeys, NOW)).ok);

const otherKeys = await generateSigningKeys("sk-test");
const wrongSig = await signReceipt(payload, otherKeys);
check("signatur fra feil nøkkel avvises", !(await verifyReceipt(wrongSig, bothKeys, NOW)).ok);

const unknownKid = await verifyReceipt(envelope, [await importVerifyKeys({ ...jwks, kid: "sk-annen" })], NOW);
check("ukjent kid avvises", !unknownKid.ok && unknownKid.reason?.includes("nøkkel-id") === true);

check("tilstand 'varsel' etter dag 70", (await verifyReceipt(envelope, bothKeys, NOW + RECEIPT_SOFT_TTL_SEC + 60)).state === "varsel");
check("tilstand 'utlopt' etter dag 100", (await verifyReceipt(envelope, bothKeys, NOW + RECEIPT_TTL_SEC + 60)).state === "utlopt");
check("søppel avvises pent", !(await verifyReceipt("SSLIC1.abc", bothKeys, NOW)).ok);

// ---------- Hashing og koder ----------
console.log("\n— Hashing og koder —");
const P = "test-pepper-1";
check("e-posthash er deterministisk og case-ufølsom", (await hashEmail(P, " Elev@Skole.no ")) === (await hashEmail(P, "elev@skole.no")));
check("annet pepper gir annen hash", (await hashEmail(P, "elev@skole.no")) !== (await hashEmail("annet-pepper", "elev@skole.no")));
check("kodehash bindes til e-post", (await hashCode(P, "a@b.no", "1234567")) !== (await hashCode(P, "c@d.no", "1234567")));
check("maskering", maskEmail("jk@telemarkfylke.no") === "j***@telemarkfylke.no");

const codes = new Set<string>();
for (let i = 0; i < 1000; i++) codes.add(generateLicenseCode());
check("1000 koder har riktig format", [...codes].every((c) => isValidCodeFormat(c)));
check("koder er rimelig unike (ingen kollisjonseksplosjon)", codes.size > 990, `${codes.size}`);
check("formatering «123 4567»", formatLicenseCode("1234567") === "123 4567");
check("normalisering godtar mellomrom og bindestrek", normalizeLicenseCode("123 4-567") === "1234567");

// ---------- Serverlogikk mot MemoryDb ----------
console.log("\n— Serverlogikk: import → innlogging → fornyelse → stenging —");
const db = new MemoryDb();
let idCounter = 0;
const newId = () => `id-${++idCounter}`;
await db.createTenant({ id: "t1", slug: "dysleksi-norge", name: "Dysleksi Norge", status: "aktiv", validTo: null });
await db.createPool({
  id: "p1",
  tenantId: "t1",
  name: "Medlemmer 2026",
  status: "aktiv",
  validTo: null,
  products: { "edge-extension": { features: ["tts", "ordbok", "stavekontroll", "prediksjon"] } },
});

const imp = await importEntries(db, P, "p1", ["kari@eksempel.no", "OLA@eksempel.no", "kari@eksempel.no", "ugyldig-epost"], newId);
check("import: 2 gyldige inn, 2 hoppet over (duplikat + ugyldig)", imp.imported.length === 2 && imp.skipped.length === 2, JSON.stringify(imp.skipped));
check("import: koder i eksportlisten har riktig format", imp.imported.every((r) => isValidCodeFormat(r.code)));

const kari = imp.imported.find((r) => r.email === "kari@eksempel.no")!;

const bad = await login(db, P, keys, { email: "kari@eksempel.no", code: "0000000", product: "edge-extension", ip: "88.1.2.3", nowSec: NOW }, newId);
check("feil kode avvises", !bad.ok && bad.reason === "feil-kode");

const good = await login(db, P, keys, { email: "Kari@Eksempel.no", code: formatLicenseCode(kari.code), product: "edge-extension", ip: "88.1.2.3", nowSec: NOW }, newId);
check("riktig kode logger inn (case + formatert kode tåles)", good.ok);
if (good.ok) {
  const vr = await verifyReceipt(good.receipt, bothKeys, NOW);
  check("innloggingskvittering verifiserer og bærer produktene", vr.ok && vr.payload?.products["edge-extension"].features.includes("tts") === true);
  check("kvitteringen varer 100 dager", vr.payload?.exp === NOW + RECEIPT_TTL_SEC);

  const r1 = await refresh(db, P, keys, { installId: good.installId, installSecret: good.installSecret, product: "edge-extension", ip: "78.9.9.9", nowSec: NOW + 86_400 }, );
  check("fornyelse med installasjonshemmelighet", r1.ok);
  if (r1.ok) {
    const vv = await verifyReceipt(r1.receipt, bothKeys, NOW + 86_400);
    check("glidende utløp: ny kvittering varer 100 dager fra nå", vv.payload?.exp === NOW + 86_400 + RECEIPT_TTL_SEC);
  }
  const r2 = await refresh(db, P, keys, { installId: good.installId, installSecret: "feil-hemmelighet", product: "edge-extension", ip: "78.9.9.9", nowSec: NOW + 86_400 });
  check("feil installasjonshemmelighet avvises", !r2.ok);

  const entryId = [...db.entries.values()].find((e) => e.emailMasked === "k***@eksempel.no")!.id;
  check("misbruksteller: 2 ulike nett registrert", (await db.distinctNets(entryId, "2026-08-12")) + (await db.distinctNets(entryId, "2026-08-13")) === 2);
  check("revisjonsspor: 2 kvitteringer loggført (innlogging + fornyelse)", db.receipts.filter((r) => r.entryId === entryId).length === 2, `${db.receipts.length}`);

  await closeEntry(db, entryId, "kode spredd på nettet");
  const r3 = await refresh(db, P, keys, { installId: good.installId, installSecret: good.installSecret, product: "edge-extension", ip: "78.9.9.9", nowSec: NOW + 2 * 86_400 });
  check("stengt konto avvises ved fornyelse", !r3.ok && !r3.ok && r3.reason === "stengt");
}

// Ratebegrensning: bruk opp vinduet med feil koder — så avvises selv riktig kode
const ola = imp.imported.find((r) => r.email === "ola@eksempel.no")!;
for (let i = 0; i < MAX_ATTEMPTS_PER_EMAIL; i++) {
  await login(db, P, keys, { email: "ola@eksempel.no", code: "9999999", product: "edge-extension", ip: "10.0.0.1", nowSec: NOW + i }, newId);
}
const limited = await login(db, P, keys, { email: "ola@eksempel.no", code: ola.code, product: "edge-extension", ip: "10.0.0.1", nowSec: NOW + 10 }, newId);
check("ratebegrensning: riktig kode avvises når vinduet er brukt opp", !limited.ok && limited.reason === "for-mange-forsok");
const afterWindow = await login(db, P, keys, { email: "ola@eksempel.no", code: ola.code, product: "edge-extension", ip: "10.0.0.1", nowSec: NOW + 16 * 60 }, newId);
check("…og slipper inn etter at vinduet er ute", afterWindow.ok);

console.log(failed === 0 ? `\nALLE OK (${n} tester)` : `\n${failed} av ${n} FEILET`);
process.exit(failed === 0 ? 0 : 1);
