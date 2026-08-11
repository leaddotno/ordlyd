/**
 * Evaluerer dysleksi-stavekontrollen mot det syntetiske datasettet.
 * Kjør: pnpm exec tsx scripts/eval-spellcheck.mts [train|validation|test]
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SpellChecker } from "../packages/writing-engine/src/spellcheck.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPLIT = process.argv[2] ?? "test";

const words = readFileSync(join(ROOT, "assets", "dict", "nb.txt"), "utf8")
  .split("\n")
  .filter(Boolean);
console.log(`ordbank: ${words.length} former`);
const t0 = Date.now();
const checker = new SpellChecker(words);
console.log(`indeks bygget på ${Date.now() - t0} ms`);

interface Row {
  error: string;
  correct: string;
  category: string;
  weight: number;
}

const rows: Row[] = [];
const raw = readFileSync(join(ROOT, "data", "dysleksi_bokmal_syntetisk_dataset_v1.txt"), "utf8");
for (const line of raw.split("\n")) {
  if (line.startsWith("#") || !line.trim()) continue;
  const c = line.split("\t");
  if (c[0] === "id" || c.length < 13) continue;
  const [, level, error, correct, category, , , , , weight, , split] = c;
  if (level !== "word" || split !== SPLIT) continue;
  // kun enkeltord (særskrivingsfeil med mellomrom krever setningskontekst)
  if (error.includes(" ") || correct.includes(" ")) continue;
  rows.push({ error, correct, category, weight: Number(weight) || 1 });
}
console.log(`${rows.length} ordnivå-rader i split=${SPLIT}\n`);

const perCategory = new Map<string, { n: number; top1: number; top3: number; known: number }>();
let top1 = 0;
let top3 = 0;
let alreadyKnown = 0;
const misses: string[] = [];

const tEval = Date.now();
for (const row of rows) {
  const cat = row.category.split("+")[0];
  let stats = perCategory.get(cat);
  if (!stats) perCategory.set(cat, (stats = { n: 0, top1: 0, top3: 0, known: 0 }));
  stats.n++;

  if (checker.isKnown(row.error)) {
    // feilstavingen er selv et gyldig ord (f.eks. «vist» for «visst») —
    // kan ikke fanges uten setningskontekst
    alreadyKnown++;
    stats.known++;
    continue;
  }
  const suggestions = checker.suggest(row.error, 3);
  const hit = suggestions.indexOf(row.correct.toLowerCase());
  if (hit === 0) {
    top1++;
    top3++;
    stats.top1++;
    stats.top3++;
  } else if (hit > 0) {
    top3++;
    stats.top3++;
  } else if (misses.length < 25) {
    misses.push(`${row.error} → fasit «${row.correct}», fikk [${suggestions.join(", ")}] (${cat})`);
  }
}
const evalMs = Date.now() - tEval;

const catchable = rows.length - alreadyKnown;
console.log(`Evaluert på ${evalMs} ms (${(evalMs / rows.length).toFixed(1)} ms/ord)`);
console.log(`Feilstavinger som selv er gyldige ord (krever kontekst): ${alreadyKnown} (${((alreadyKnown / rows.length) * 100).toFixed(1)} %)`);
console.log(`\nAv de ${catchable} som KAN fanges på ordnivå:`);
console.log(`  Topp-1: ${((top1 / catchable) * 100).toFixed(1)} %`);
console.log(`  Topp-3: ${((top3 / catchable) * 100).toFixed(1)} %  (mål: ≥ 80 %)\n`);

console.log("Per kategori (topp-3 av fangbare):");
const cats = [...perCategory.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [cat, s] of cats) {
  const c = s.n - s.known;
  if (c === 0) continue;
  console.log(`  ${cat.padEnd(24)} ${String(s.n).padStart(5)} rader  topp-3: ${((s.top3 / c) * 100).toFixed(1)} %`);
}
console.log("\nEksempler på bom:");
for (const m of misses) console.log("  " + m);
