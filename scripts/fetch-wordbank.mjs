/**
 * Bygger den norske ordbank-pakken for ordprediksjon.
 * Kilde: HermitDave FrequencyWords (OpenSubtitles-korpus, åpen lisens).
 * Resultat: assets/dict/nb.txt — ett ord per linje, sortert etter frekvens
 * (mest brukte først). Byttes ut med Norsk ordbank/Språkbanken i full fase 4.
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/no/no_full.txt";
const DEST = join(ROOT, "assets", "dict", "nb.txt");
const MAX_WORDS = 120_000;
const MIN_FREQ = 3;

const exists = await stat(DEST).then((s) => s.size > 0).catch(() => false);
if (exists) {
  console.log("✓ ordbank finnes allerede:", DEST);
  process.exit(0);
}

console.log("⬇ laster ned frekvensliste …");
const res = await fetch(SRC);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const raw = await res.text();

// Kun ekte norske ordformer: bokstaver (inkl. æøå og lånte aksenter), evt. bindestrek
const WORD_RE = /^[a-zæøåäöüéèêáàóòô]+(?:-[a-zæøåäöüéèêáàóòô]+)*$/;
const SHORT_WHITELIST = new Set(["i", "å"]);

const words = [];
for (const line of raw.split("\n")) {
  const [word, freqStr] = line.split(" ");
  if (!word || !freqStr) continue;
  const freq = Number(freqStr);
  if (freq < MIN_FREQ) break; // listen er frekvenssortert
  if (word.length === 1 && !SHORT_WHITELIST.has(word)) continue;
  if (!WORD_RE.test(word)) continue;
  words.push(word);
  if (words.length >= MAX_WORDS) break;
}

await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, words.join("\n"), "utf8");
console.log(`✓ ordbank bygget: ${words.length} ord → ${DEST}`);
