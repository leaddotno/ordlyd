/**
 * Tester tekstnormaliseringen for talesyntese.
 * Kjør: pnpm exec tsx scripts/test-normalize.mts
 *
 * Tre nivåer:
 *  1. normalizeForSpeech alene
 *  2. splitSentences alene
 *  3. HELE KJEDEN (del → normaliser hver setning) — slik motoren faktisk
 *     gjør det. Nivå 1 og 2 kan være grønne mens kjeden er ødelagt: en
 *     setningsdeler som hakker «17.05.2026» i tre biter gjør at
 *     normaliseringen aldri ser mønsteret.
 */
import { normalizeForSpeech, setPronunciationOverrides } from "../packages/tts/src/normalize.js";
import { splitSentences } from "../packages/tts/src/text.js";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
setPronunciationOverrides(
  JSON.parse(readFileSync(join(ROOT, "assets", "dict", "uttale-overrides.json"), "utf8")),
);

let failed = 0;
const check = (label: string, got: string, expected: string): void => {
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label} → «${got}»${ok ? "" : `\n    FORVENTET: «${expected}»`}`);
};

console.log("— Normalisering —");
const cases: Array<[string, string]> = [
  ["Det koster ca. 2.500 kr i året.", "Det koster cirka 2500 kroner i året."],
  ["Møtet er kl. 14:30 den 17.05.2026.", "Møtet er klokka 14 30 den 17. mai 2026."],
  ["Vi kjørte i 80 km/t.", "Vi kjørte i 80 kilometer i timen."],
  ["Prisen økte med 12 %.", "Prisen økte med 12 prosent."],
  ["Det var 25 °C ute.", "Det var 25 grader ute."],
  ["Les bl.a. kap. 3, dvs. side 12.", "Les blant annet kapittel 3, det vil si side 12."],
  ["Hun er journalist i avisen.", "Hun er sjurnalist i avisen."],
  ["Journalistene spiste pizza.", "sjurnalistene spiste pitsa."],
  ["F.eks. denne.", "for eksempel denne."],
  ["Gyldig f.o.m. 1. mai t.o.m. 17. mai.", "Gyldig fra og med 1. mai til og med 17. mai."],
  ["Fisk & vilt", "Fisk og vilt"],
  ["Se § 3 i loven.", "Se paragraf 3 i loven."],
  // Rapportert av bruker: forkortelser uten avsluttende punktum
  ["F.eks denne.", "for eksempel denne."],
  ["Gyldig f.o.m 1. mai.", "Gyldig fra og med 1. mai."],
  ["Kom bl.a hit, dvs nå.", "Kom blant annet hit, det vil si nå."],
  ["Se kap 3 og pkt 4.", "Se kapittel 3 og punkt 4."],
  // Tall og datoer
  ["Beløpet var 2.500.000 kroner.", "Beløpet var 2500000 kroner."],
  ["Frist 01.01.2027 gjelder.", "Frist 1. januar 2027 gjelder."],
  ["Skjedde 17.05.26 i fjor.", "Skjedde 17. mai 26 i fjor."],
  ["Ugyldig dato 45.99.2026 her.", "Ugyldig dato 45.99.2026 her."],
  // Ord og tall som IKKE skal røres
  ["Journalen ligger klar.", "Journalen ligger klar."],
  ["Kamera og campusområdet.", "Kamera og campusområdet."],
  ["Versjon 3.14 er ute.", "Versjon 3.14 er ute."],
];
for (const [input, expected] of cases) check(`«${input}»`, normalizeForSpeech(input), expected);

console.log("\n— Setningsdeling —");
const splitCases: Array<[string, string[]]> = [
  [
    "Journalisten kom kl. 14:30 den 17.05.2026 og spiste pizza til 2.500 kr, dvs. bl.a. med 25 % rabatt.",
    ["Journalisten kom kl. 14:30 den 17.05.2026 og spiste pizza til 2.500 kr, dvs. bl.a. med 25 % rabatt."],
  ],
  ["Hei på deg. Dette er setning to! Er dette tre?", ["Hei på deg.", "Dette er setning to!", "Er dette tre?"]],
  ["Prisen er 3.14 kroner. Neste setning.", ["Prisen er 3.14 kroner.", "Neste setning."]],
  ["Vent... Hva var det?!", ["Vent...", "Hva var det?!"]],
  ["Møt opp kl. 8. Ta med bok.", ["Møt opp kl. 8.", "Ta med bok."]],
  ["F.eks denne. Og denne.", ["F.eks denne.", "Og denne."]],
];
for (const [input, expected] of splitCases) {
  const got = splitSentences(input).map((s) => s.text);
  check(`deling «${input.slice(0, 44)}…»`, JSON.stringify(got), JSON.stringify(expected));
}

/**
 * Nivå 3: samme rekkefølge som SpeechController — del først, normaliser
 * hver setning. Dette er testen som fanger regresjonen brukeren rapporterte.
 */
console.log("\n— Hele kjeden (del → normaliser) —");
const pipeline = (text: string): string =>
  splitSentences(text)
    .map((s) => normalizeForSpeech(s.text))
    .join(" | ");
const pipelineCases: Array<[string, string]> = [
  [
    "Møtet er 17.05.2026. Ta med bok.",
    "Møtet er 17. mai 2026. | Ta med bok.",
  ],
  ["F.eks. dette er viktig.", "for eksempel dette er viktig."],
  ["F.eks dette er viktig.", "for eksempel dette er viktig."],
  ["Gyldig f.o.m. 01.08.2026 og ut året.", "Gyldig fra og med 1. august 2026 og ut året."],
  [
    "Vi møtes kl. 14:30. Det koster ca. 2.500 kr, dvs. bl.a. moms.",
    "Vi møtes klokka 14 30. | Det koster cirka 2500 kroner, det vil si blant annet moms.",
  ],
];
for (const [input, expected] of pipelineCases) check(`kjede «${input}»`, pipeline(input), expected);

/**
 * Nivå 4: er det bygde bundlet nyere enn kilden? En stale dist er nøyaktig
 * det som gjorde at fiksene over ikke virket i utvidelsen ved forrige test.
 */
console.log("\n— Byggets ferskhet —");
const newestSource = ["packages/tts/src", "packages/writing-engine/src", "apps/extension/src"]
  .flatMap((dir) => {
    const abs = join(ROOT, dir);
    try {
      return readdirSync(abs).map((f) => statSync(join(abs, f)).mtimeMs);
    } catch {
      return [];
    }
  })
  .reduce((a, b) => Math.max(a, b), 0);
const bundle = join(ROOT, "apps", "extension", "dist", "offscreen.js");
let bundleTime = 0;
try {
  bundleTime = statSync(bundle).mtimeMs;
} catch {
  /* ikke bygget ennå */
}
if (bundleTime === 0) {
  console.log("⚠ apps/extension/dist/offscreen.js finnes ikke — kjør pnpm build");
} else if (bundleTime < newestSource) {
  failed++;
  console.log(
    `✗ dist er ELDRE enn kilden (${new Date(bundleTime).toISOString()} < ${new Date(newestSource).toISOString()})\n` +
      "    Utvidelsen i nettleseren kjører gammel kode. Kjør: pnpm build",
  );
} else {
  console.log("✓ dist er nyere enn kilden");
}

console.log(failed === 0 ? "\nALLE OK" : `\n${failed} FEILET`);
process.exit(failed === 0 ? 0 : 1);
