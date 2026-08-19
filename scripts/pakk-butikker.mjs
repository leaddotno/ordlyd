/**
 * Bygger og pakker Ordlyd for BEGGE butikkene, i én kommando.
 *
 * Kravet er at Edge og Chrome aldri kommer ut av takt. Den tryggeste
 * måten å holde et slikt krav er å gjøre det umulig å bryte: det finnes
 * ingen kommando som lager bare den ene pakken til daglig bruk. Vil du
 * likevel ha én, går det gjennom package-extension.mjs direkte.
 *
 * Rekkefølgen er ikke tilfeldig. Chrome pakkes SIST, slik at dist/ står
 * igjen med Chrome-bygget — og et Chrome-bygg som ved en feil sendes til
 * Edge blir avvist av butikkvakten, mens omvendt ville sluppet gjennom
 * uoppdaget.
 *
 * Kjør:  node scripts/pakk-butikker.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UTVIDELSE = join(ROOT, "apps", "extension");
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const manifest = JSON.parse(readFileSync(join(UTVIDELSE, "public", "manifest.json"), "utf8"));
const versjon = manifest.version;

/*
 * `shell` bare der det trengs. pnpm er en .cmd-fil på Windows og krever
 * skallet; node gjør ikke det — og med skallet slått på brekker stien
 * «C:\Program Files
odejs
ode.exe» ved mellomrommet.
 */
function kjør(kommando, argumenter, { env = {}, skall = false } = {}) {
  execFileSync(kommando, argumenter, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: skall,
  });
}

const resultat = [];

for (const butikk of ["edge", "chrome"]) {
  console.log(`\n${"=".repeat(64)}\n  ${butikk.toUpperCase()} — Ordlyd ${versjon}\n${"=".repeat(64)}`);

  // emptyOutDir i vite.config rydder dist mellom byggene, så de to
  // pakkene kan ikke blande innhold.
  kjør(PNPM, ["--filter", "@ordlyd/extension", "build"], {
    env: { ORDLYD_BUTIKK: butikk },
    skall: process.platform === "win32",
  });
  kjør(process.execPath, [
    join("scripts", "package-extension.mjs"),
    ...(butikk === "chrome" ? ["--chrome"] : []),
  ]);

  const fil = join(ROOT, `ordlyd-${butikk}-${versjon}.zip`);
  const bytes = readFileSync(fil);
  resultat.push({
    butikk,
    fil: `ordlyd-${butikk}-${versjon}.zip`,
    mb: (statSync(fil).size / 1048576).toFixed(1),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

console.log(`\n${"=".repeat(64)}\n  KLAR — Ordlyd ${versjon}\n${"=".repeat(64)}`);
for (const r of resultat) {
  console.log(`\n  ${r.butikk.toUpperCase().padEnd(7)} ${r.fil}  ${r.mb} MB`);
  console.log(`          sha256 ${r.sha256}`);
}
console.log(`
  Last opp:
    Edge    Partner Center  → ordlyd-edge-${versjon}.zip
    Chrome  Web Store       → ordlyd-chrome-${versjon}.zip

  Sjekksummene SKAL være ulike — pakkene er med vilje forskjellige.
  Er de like, er butikkflagget ikke slått gjennom i bygget.
`);

if (resultat[0].sha256 === resultat[1].sha256) {
  console.error("  ✗ Pakkene er identiske. Butikkvalget nådde ikke bygget.\n");
  process.exit(1);
}
