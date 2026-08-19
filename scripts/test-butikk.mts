/**
 * Tester speilingen av rettigheter mellom Edge og Chrome.
 *
 * Poolene i produksjon ble opprettet før Chrome kom til og har bare
 * `edge-extension`. Går denne speilingen i stykker, får en Chrome-bruker
 * med helt gyldig lisens ingen funksjoner — og feilen ser ut som et
 * lisensproblem, ikke som et produktnøkkelproblem. Derfor egen test.
 *
 * Kjør:  pnpm exec tsx scripts/test-butikk.mts
 */
import { medButikkalias } from "../apps/lisensserver/src/logic.js";

let feil = 0;
let n = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

const ALLE = ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"];

/* --- Det virkelige tilfellet: pool laget før Chrome fantes --- */
const bareEdge = medButikkalias({ "edge-extension": { features: ALLE } });
sjekk("en Edge-pool gir også Chrome-rettigheter", bareEdge["chrome-extension"]?.features.length === 5, bareEdge);
sjekk("Edge-rettighetene er urørt", bareEdge["edge-extension"]?.features.length === 5);
sjekk(
  "begge peker på samme funksjonsliste",
  JSON.stringify(bareEdge["edge-extension"]) === JSON.stringify(bareEdge["chrome-extension"]),
);

/* --- Motsatt vei, for en pool som en dag lages med Chrome-nøkkelen --- */
const bareChrome = medButikkalias({ "chrome-extension": { features: ["tts"] } });
sjekk("en Chrome-pool gir også Edge-rettigheter", bareChrome["edge-extension"]?.features.join() === "tts", bareChrome);

/* --- Ulike lister skal IKKE overskrives --- */
const begge = medButikkalias({
  "edge-extension": { features: ["tts"] },
  "chrome-extension": { features: ["ordbok"] },
});
sjekk("er begge satt eksplisitt, røres ingen av dem", begge["edge-extension"].features.join() === "tts"
  && begge["chrome-extension"].features.join() === "ordbok", begge);

/* --- Andre produkter skal ikke smittes --- */
const medDesktop = medButikkalias({
  "edge-extension": { features: ["tts"] },
  "win-desktop": { features: ["tts", "ordbok"] },
});
sjekk("win-desktop berøres ikke", medDesktop["win-desktop"].features.length === 2);
sjekk("win-desktop gir ikke nettleserrettigheter",
  medButikkalias({ "win-desktop": { features: ["tts"] } })["edge-extension"] === undefined);

/* --- Tomt inn, tomt ut --- */
sjekk("tom rettighetsliste gir tom liste", Object.keys(medButikkalias({})).length === 0);

/* --- Ingen muterer originalen --- */
const original = { "edge-extension": { features: ["tts"] } };
medButikkalias(original);
sjekk("originalen muteres ikke", Object.keys(original).length === 1, original);

console.log(feil === 0 ? `\nALLE ${n} OK` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
