/**
 * Tester tekstnormaliseringen for talesyntese.
 * Kjør: pnpm exec tsx scripts/test-normalize.mts
 */
import { normalizeForSpeech, setPronunciationOverrides } from "../packages/tts/src/normalize.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
setPronunciationOverrides(
  JSON.parse(readFileSync(join(ROOT, "assets", "dict", "uttale-overrides.json"), "utf8")),
);

const cases: Array<[string, string]> = [
  ["Det koster ca. 2.500 kr i året.", "Det koster cirka 2500 kroner i året."],
  ["Møtet er kl. 14:30 den 17.05.2026.", "Møtet er klokka 14 30 den 17. mai 2026."],
  ["Vi kjørte i 80 km/t.", "Vi kjørte i 80 kilometer i timen."],
  ["Prisen økte med 12 %.", "Prisen økte med 12 prosent."],
  ["Det var 25 °C ute.", "Det var 25 grader ute."],
  ["Les bl.a. kap. 3, dvs. side 12.", "Les blant annet kap. 3, det vil si side 12."],
  ["Hun er journalist i avisen.", "Hun er sjurnalist i avisen."],
  ["Journalistene spiste pizza.", "sjurnalistene spiste pitsa."],
  ["F.eks. denne.", "for eksempel denne."],
  ["Gyldig f.o.m. 1. mai t.o.m. 17. mai.", "Gyldig fra og med 1. mai til og med 17. mai."],
  ["Fisk & vilt", "Fisk og vilt"],
  ["Se § 3 i loven.", "Se paragraf 3 i loven."],
  // Ord og tall som IKKE skal røres
  ["Journalen ligger klar.", "Journalen ligger klar."],
  ["Kamera og campusområdet.", "Kamera og campusområdet."],
  ["Versjon 3.14 er ute.", "Versjon 3.14 er ute."],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = normalizeForSpeech(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} «${input}» → «${got}»${ok ? "" : `  FORVENTET: «${expected}»`}`);
}

// Setningsdeling: forkortelser og tall skal IKKE splitte
const { splitSentences } = await import("../packages/tts/src/text.js");
const splitCases: Array<[string, string[]]> = [
  [
    "Journalisten kom kl. 14:30 den 17.05.2026 og spiste pizza til 2.500 kr, dvs. bl.a. med 25 % rabatt.",
    ["Journalisten kom kl. 14:30 den 17.05.2026 og spiste pizza til 2.500 kr, dvs. bl.a. med 25 % rabatt."],
  ],
  ["Hei på deg. Dette er setning to! Er dette tre?", ["Hei på deg.", "Dette er setning to!", "Er dette tre?"]],
  ["Prisen er 3.14 kroner. Neste setning.", ["Prisen er 3.14 kroner.", "Neste setning."]],
  ["Vent... Hva var det?!", ["Vent...", "Hva var det?!"]],
  ["Møt opp kl. 8. Ta med bok.", ["Møt opp kl. 8.", "Ta med bok."]],
];
for (const [input, expected] of splitCases) {
  const got = splitSentences(input).map((s) => s.text);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} deling: «${input.slice(0, 50)}…» → ${JSON.stringify(got)}${ok ? "" : `  FORVENTET: ${JSON.stringify(expected)}`}`);
}

console.log(failed === 0 ? "\nALLE OK" : `\n${failed} FEILET`);
process.exit(failed === 0 ? 0 : 1);
