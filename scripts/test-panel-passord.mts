/**
 * Krysssjekk mellom panelets passordforslag og serverens passordregel.
 *
 * De to er skrevet uavhengig av hverandre — generatoren i panelets
 * HTML, regelen i passord.ts — så dette er en ekte test og ikke en
 * tautologi. Uten den kan noen stramme regelen på serveren og etterlate
 * en «foreslå et sterkt»-knapp som produserer passord serveren avviser.
 *
 * Generatorkoden hentes ut av HTML-en og kjøres, slik at testen følger
 * panelet også hvis noen endrer alfabetet der.
 *
 * Kjør:  pnpm exec tsx scripts/test-panel-passord.mts
 */
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { sjekkPassord } from "../apps/lisensserver/src/passord.js";

const HTML = "apps/lisensserver/public/admin/index.html";
const ANTALL = 300;

let feil = 0;
let n = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

/* Hent generatoren ut av klikkbehandleren i panelet. */
const html = readFileSync(HTML, "utf8");
const start = html.indexOf('$("aLagPassord").addEventListener("click", () => {');
const slutt = html.indexOf("});", html.indexOf('$("aPassordKrav").textContent', start));
sjekk("fant passordgeneratoren i panelet", start > 0 && slutt > start, { start, slutt });
if (start < 0) process.exit(1);

let kropp = html.slice(html.indexOf("{", start) + 1, slutt);
// Fjern de to linjene som rører DOM-en, og returner verdien i stedet.
kropp = kropp
  .replace(/\$\("aPassord"\)\.value = tegn\.join\(""\);/, "return tegn.join('');")
  .replace(/\$\("aPassordKrav"\)[\s\S]*$/, "");

const lagPassord = new Function("crypto", kropp) as (c: Crypto) => string;

const passord: string[] = [];
for (let i = 0; i < ANTALL; i++) passord.push(lagPassord(webcrypto as unknown as Crypto));

sjekk("genererer noe i det hele tatt", passord.every((p) => typeof p === "string" && p.length > 0));
sjekk("alle er 16 tegn", passord.every((p) => p.length === 16), passord[0]);
sjekk("ingen gjentakelser på 300 forsøk", new Set(passord).size === ANTALL);

/* Det som betyr noe: består de serverens egen regel? */
const avvist = passord
  .map((p) => ({ p, feil: sjekkPassord(p, { epost: "kari@eksempel.no", navn: "Kari Nordmann" }) }))
  .filter((x) => x.feil.length);
sjekk(
  `alle ${ANTALL} forslag består serverens passordregel`,
  avvist.length === 0,
  avvist.slice(0, 3).map((x) => ({ passord: x.p, mangler: x.feil.map((f) => f.kode) })),
);

/* Fordeling: en generator som klumper seg er en generator som gjentar seg. */
const brukteTegn = new Set(passord.join(""));
sjekk("bruker et bredt tegnsett", brukteTegn.size >= 40, brukteTegn.size);
sjekk(
  "ingen forvekslingstegn (l, I, O, 0, 1)",
  ![..."lIO01"].some((c) => brukteTegn.has(c)),
  [...brukteTegn].filter((c) => "lIO01".includes(c)),
);

console.log(feil === 0 ? `\nALLE ${n} OK` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
