/**
 * Bygger den norske ordbank-pakken for ordprediksjon (assets/dict/nb.txt).
 *
 * Kilder:
 *  - Norsk ordbank bokmål 2005 (Språkbanken, CC-BY 4.0): fullformslisten
 *    gir alle offisielle bøyningsformer → kun ekte norske ord foreslås.
 *  - Frekvensliste fra undertekstkorpus (HermitDave/OpenSubtitles):
 *    gir rangeringen (mest brukte ord først).
 *
 * Resultat: to lag i én liste —
 *  1. frekvensrangerte former som finnes i ordbanken (støy som «gjørjeg»
 *     forsvinner fordi de ikke er gyldige ordformer)
 *  2. øvrige bøyningsformer av kjente lemma, rangert etter lemmaets frekvens
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FREQ_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/no/no_full.txt";
const ORDBANK_URL =
  "https://www.nb.no/sbfil/leksikalske_databaser/ordbank/20220201_norsk_ordbank_nob_2005.tar.gz";

const FREQ_FILE = join(ROOT, "assets", "raw", "no_full.txt");
const ORDBANK_DIR = join(ROOT, "assets", "ordbank");
const ORDBANK_TAR = join(ORDBANK_DIR, "ordbank.tar.gz");
const FULLFORM_FILE = join(ORDBANK_DIR, "fullformsliste.txt");
const DEST = join(ROOT, "assets", "dict", "nb.txt");

const MAX_TOTAL = 700_000;
const MIN_FREQ = 3;
const WORD_RE = /^[a-zæøåäöüéèêáàóòô]+(?:-[a-zæøåäöüéèêáàóòô]+)*$/;
const SHORT_WHITELIST = new Set(["i", "å"]);

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  console.log(`⬇ laster ned ${url.split("/").pop()} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/* ---------- 1. Skaff kildene ---------- */
if (!existsSync(FREQ_FILE)) await download(FREQ_URL, FREQ_FILE);
if (!existsSync(FULLFORM_FILE)) {
  if (!existsSync(ORDBANK_TAR)) await download(ORDBANK_URL, ORDBANK_TAR);
  console.log("📦 pakker ut fullformsliste …");
  execFileSync("tar", ["-xzf", ORDBANK_TAR, "-C", ORDBANK_DIR, "fullformsliste.txt"]);
}

/* ---------- 2. Les Norsk ordbank (latin-1!) ---------- */
console.log("leser Norsk ordbank …");
const fullforms = (await readFile(FULLFORM_FILE, "latin1")).split("\n");
const validForms = new Set();
const lemmaForms = new Map(); // lemmaId → Set<form>
for (const line of fullforms) {
  const cols = line.split("\t");
  if (cols.length < 9) continue;
  const [, lemmaId, oppslag, , , , , tilDato, normering] = cols;
  if (normering.trim() !== "normert") continue;
  if (!tilDato.startsWith("4000")) continue; // utgåtte former
  const form = oppslag.toLowerCase();
  if (!WORD_RE.test(form)) continue;
  if (form.length === 1 && !SHORT_WHITELIST.has(form)) continue;
  validForms.add(form);
  let set = lemmaForms.get(lemmaId);
  if (!set) lemmaForms.set(lemmaId, (set = new Set()));
  set.add(form);
}
console.log(`  ${validForms.size} gyldige former, ${lemmaForms.size} lemma`);

/* ---------- 3. Les frekvenslisten ---------- */
console.log("leser frekvensliste …");
const freq = new Map(); // form → frekvens
for (const line of (await readFile(FREQ_FILE, "utf8")).split("\n")) {
  const [word, freqStr] = line.split(" ");
  if (!word || !freqStr) continue;
  const f = Number(freqStr);
  if (f < MIN_FREQ) break; // listen er sortert
  freq.set(word, f);
}

/* ---------- 4. Lag 1: frekvensrangerte gyldige former ---------- */
const result = [];
const included = new Set();
for (const [word] of freq) {
  if (validForms.has(word) && !included.has(word)) {
    result.push(word);
    included.add(word);
  }
}
const tier1 = result.length;

/* ---------- 5. Lag 2: øvrige bøyningsformer, etter lemmafrekvens ---------- */
const lemmaFreq = [];
for (const [lemmaId, forms] of lemmaForms) {
  let best = 0;
  for (const form of forms) best = Math.max(best, freq.get(form) ?? 0);
  if (best > 0) lemmaFreq.push([best, forms]);
}
lemmaFreq.sort((a, b) => b[0] - a[0]);
outer: for (const [, forms] of lemmaFreq) {
  for (const form of forms) {
    if (included.has(form)) continue;
    result.push(form);
    included.add(form);
    if (result.length >= MAX_TOTAL) break outer;
  }
}
const tier2 = result.length;

/* ---------- 6. Lag 3: resten av ordbanken (for stavekontroll-dekning) ---------- */
// Prediksjonen bruker bare de øverste lagene (limit i Predictor), men
// stavekontrollen må kunne foreslå sjeldne-men-riktige ord («gjøk»).
const rest = [...validForms].filter((f) => !included.has(f)).sort();
for (const form of rest) {
  if (result.length >= MAX_TOTAL) break;
  result.push(form);
}

await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, result.join("\n"), "utf8");
console.log(
  `✓ ordbank-pakke: ${result.length} former (${tier1} frekvensrangerte + ${tier2 - tier1} bøyningsformer + ${result.length - tier2} sjeldne) → ${DEST}`,
);
