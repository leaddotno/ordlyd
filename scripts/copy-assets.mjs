/**
 * Kopierer offline-ressursene inn i appene:
 *  - assets/voices/**            → apps/{extension,demo}/public/voices/
 *  - onnxruntime-web dist *.wasm → apps/{extension,demo}/public/ort/
 *  - piper_phonemize wasm+data   → apps/{extension,demo}/public/piper/
 * Kjør scripts/fetch-voice.mjs først (én gang) for å hente stemmen.
 */
import { cp, mkdir, stat, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPS = [join(ROOT, "apps", "extension"), join(ROOT, "apps", "demo")];

// pnpm symlinker avhengighetene til packages/tts rett under dens node_modules
const ttsModules = join(ROOT, "packages", "tts", "node_modules");
const ortDist = join(ttsModules, "onnxruntime-web", "dist");
const piperBuild = join(ttsModules, "@diffusionstudio", "piper-wasm", "build");

const voicesSrc = join(ROOT, "assets", "voices");
const hasVoices = await stat(voicesSrc).then(() => true).catch(() => false);
if (!hasVoices) {
  console.error("Mangler assets/voices – kjør først: node scripts/fetch-voice.mjs");
  process.exit(1);
}

// Utvidelsen kjører alltid enkeltrådet (MV3-CSP blokkerer ORT sine
// blob:-workere), så de trådede filene er død vekt der — 21 MB spart.
// Demoen kjører på en vanlig nettside og kan bruke tråder.
const ORT_FILES_SINGLE = ["ort-wasm.wasm", "ort-wasm-simd.wasm"];
const ORT_FILES_THREADED = ["ort-wasm-threaded.wasm", "ort-wasm-simd-threaded.wasm"];

const dictSrc = join(ROOT, "assets", "dict");
const hasDict = await stat(dictSrc).then(() => true).catch(() => false);
if (!hasDict) {
  console.error("Mangler assets/dict – kjør først: node scripts/fetch-wordbank.mjs");
  process.exit(1);
}

for (const app of APPS) {
  const pub = join(app, "public");
  const isExtension = app.endsWith("extension");
  await cp(voicesSrc, join(pub, "voices"), { recursive: true });
  await cp(dictSrc, join(pub, "dict"), { recursive: true });
  await mkdir(join(pub, "ort"), { recursive: true });
  const ortFiles = isExtension
    ? ORT_FILES_SINGLE
    : [...ORT_FILES_SINGLE, ...ORT_FILES_THREADED];
  for (const f of ortFiles) {
    await copyFile(join(ortDist, f), join(pub, "ort", f));
  }
  await mkdir(join(pub, "piper"), { recursive: true });
  for (const f of ["piper_phonemize.wasm", "piper_phonemize.data"]) {
    await copyFile(join(piperBuild, f), join(pub, "piper", f));
  }
  console.log(`✓ ressurser kopiert til ${pub}`);
}
