/**
 * Pakker utvidelsen som en ZIP klar for butikk.
 *
 *   node scripts/package-extension.mjs              → Edge (standard)
 *   node scripts/package-extension.mjs --chrome     → Chrome Web Store
 *
 * Én pakke per butikk, med hver sitt navn, slik at Chrome-pakken ikke
 * inneholder Edge-betegnelser og omvendt. Skriptet SJEKKER dette til
 * slutt framfor å stole på det: en butikkstreng i feil pakke er stille
 * feil som først oppdages av en bruker som får en beskjed hun ikke kan
 * følge.
 *
 * Skriver ZIP-en selv med Nodes innebygde zlib, av to grunner: ingen ny
 * avhengighet, og full kontroll over hva som havner i pakka. Et
 * forhåndsvisnings-HTML eller en glemt kildekartfil som sniker seg med i
 * en butikkinnsending er en unødvendig runde med gjennomgang.
 *
 * Kjør: node scripts/package-extension.mjs
 * (bygg først: pnpm --filter @ordlyd/extension build)
 */
import { deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps", "extension", "dist");

const BUTIKK = process.argv.includes("--chrome") ? "chrome" : "edge";
const BUTIKKNAVN = BUTIKK === "chrome" ? "Chrome Web Store" : "Microsoft Edge Add-ons";

/**
 * Strengen som IKKE skal finnes i denne pakken. `edge://` i en
 * Chrome-pakke gir brukeren en adresse som ikke finnes i nettleseren
 * hennes — og siden teksten ser helt riktig ut, oppdages det aldri av
 * oss, bare av henne.
 */
const FORBUDT = BUTIKK === "chrome"
  ? [{ streng: "edge://", hvorfor: "finnes ikke i Chrome" },
     { streng: "edge-extension", hvorfor: "feil produktnøkkel for Chrome-pakken" }]
  : [{ streng: "chrome://extensions", hvorfor: "finnes ikke i Edge" },
     { streng: "chrome-extension\"", hvorfor: "feil produktnøkkel for Edge-pakken" }];

/**
 * Bare det utvidelsen faktisk trenger. Alt annet i dist er byggerester
 * eller verktøy for oss.
 */
const TILLATTE_ROTFILER = new Set([
  "manifest.json",
  "background.js",
  "content.js",
  "offscreen.js",
  "offscreen.html",
  "popup.js",
  "popup.html",
  "om.js",
  "om.html",
]);
const TILLATTE_MAPPER = new Set(["icons", "brand", "chunks", "assets", "voices", "ort", "piper", "dict"]);
const UTELUKK_ENDELSER = [".map", ".zip"];
/**
 * Butikklogoen lastes opp manuelt i Partner Center og skal ikke ligge i
 * utvidelsen — 64 kB død vekt hos hver bruker.
 */
const UTELUKK_FILER = new Set(["brand/butikklogo-300.png"]);

/* ------------------------------------------------------------ filutvalg */

function samleFiler(katalog, base = katalog) {
  const ut = [];
  for (const navn of readdirSync(katalog)) {
    const full = join(katalog, navn);
    const rel = relative(base, full).split(sep).join("/");
    const st = statSync(full);

    if (st.isDirectory()) {
      if (base === katalog && !TILLATTE_MAPPER.has(navn)) {
        console.log(`  hopper over mappe: ${navn}/`);
        continue;
      }
      ut.push(...samleFiler(full, base));
      continue;
    }
    if (UTELUKK_ENDELSER.some((e) => navn.endsWith(e))) continue;
    if (UTELUKK_FILER.has(rel)) {
      console.log(`  hopper over: ${rel}`);
      continue;
    }
    if (!rel.includes("/") && !TILLATTE_ROTFILER.has(navn)) {
      console.log(`  hopper over fil: ${navn}`);
      continue;
    }
    ut.push({ rel, full, størrelse: st.size });
  }
  return ut;
}

/* ------------------------------------------------------------- ZIP-skriving */

const CRC_TABELL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABELL[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Fast tidsstempel (1. januar 1980, ZIP-epoken). Da blir pakka
 * bit-identisk for samme innhold, så man kan se om noe faktisk er endret.
 */
const DOS_TID = 0;
const DOS_DATO = 33; // (1980-1980) << 9 | 1 << 5 | 1

function lokalHeader(navn, crc, komprimert, ukomprimert, metode) {
  const n = Buffer.from(navn, "utf8");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // versjon som trengs
  h.writeUInt16LE(0x0800, 6); // UTF-8-flagg
  h.writeUInt16LE(metode, 8);
  h.writeUInt16LE(DOS_TID, 10);
  h.writeUInt16LE(DOS_DATO, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(komprimert, 18);
  h.writeUInt32LE(ukomprimert, 22);
  h.writeUInt16LE(n.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, n]);
}

function sentralHeader(navn, crc, komprimert, ukomprimert, metode, offset) {
  const n = Buffer.from(navn, "utf8");
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4); // laget av
  h.writeUInt16LE(20, 6); // versjon som trengs
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(metode, 10);
  h.writeUInt16LE(DOS_TID, 12);
  h.writeUInt16LE(DOS_DATO, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(komprimert, 20);
  h.writeUInt32LE(ukomprimert, 24);
  h.writeUInt16LE(n.length, 28);
  h.writeUInt32LE(offset, 42);
  return Buffer.concat([h, n]);
}

function lagZip(filer) {
  const deler = [];
  const sentral = [];
  let offset = 0;

  for (const f of filer) {
    const rå = readFileSync(f.full);
    const crc = crc32(rå);
    // Allerede komprimerte formater blir bare større av å deflates igjen.
    const alleredeKomprimert = /\.(png|onnx|wasm|gz|zip|jpg)$/i.test(f.rel);
    const pakket = alleredeKomprimert ? rå : deflateRawSync(rå, { level: 9 });
    const metode = pakket === rå ? 0 : 8;

    deler.push(lokalHeader(f.rel, crc, pakket.length, rå.length, metode), pakket);
    sentral.push(sentralHeader(f.rel, crc, pakket.length, rå.length, metode, offset));
    offset += 30 + Buffer.byteLength(f.rel, "utf8") + pakket.length;
  }

  const sentralBuf = Buffer.concat(sentral);
  const slutt = Buffer.alloc(22);
  slutt.writeUInt32LE(0x06054b50, 0);
  slutt.writeUInt16LE(filer.length, 8);
  slutt.writeUInt16LE(filer.length, 10);
  slutt.writeUInt32LE(sentralBuf.length, 12);
  slutt.writeUInt32LE(offset, 16);

  return Buffer.concat([...deler, sentralBuf, slutt]);
}

/* ------------------------------------------------------------------- kjør */

if (!existsSync(DIST)) {
  console.error("Fant ikke apps/extension/dist. Bygg først:\n  pnpm --filter @ordlyd/extension build");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
console.log(`Pakker ${manifest.name} ${manifest.version}\n`);

const filer = samleFiler(DIST);
const ukomprimert = filer.reduce((n, f) => n + f.størrelse, 0);

// Ting som stopper en butikkinnsending, sjekket før vi bruker tid på ZIP-en
const mangler = [];
for (const s of ["16", "32", "48", "128"]) {
  if (!manifest.icons?.[s]) mangler.push(`ikon ${s}px mangler i manifest`);
  else if (!existsSync(join(DIST, manifest.icons[s]))) mangler.push(`${manifest.icons[s]} finnes ikke`);
}
if (manifest.version === "0.0.1") mangler.push("versjonen er fortsatt 0.0.1");
if ((manifest.description ?? "").length > 132) mangler.push("description er over 132 tegn");

/*
 * Butikkryddighet: den andre butikkens betegnelser skal ikke finnes i
 * denne pakken. Bare tekstfilene sjekkes — stemmer, ordbøker og
 * kjøretid er binære og kan inneholde hva som helst tilfeldig.
 *
 * Dette er en vakt mot at noen legger tilbake en hardkodet streng
 * senere. Den koster millisekunder og fanger en feil som ellers bare
 * oppdages av brukeren.
 */
const TEKSTFILER = /\.(js|html|json|css)$/i;
for (const f of filer.filter((x) => TEKSTFILER.test(x.rel))) {
  const innhold = readFileSync(f.full, "utf8");
  for (const { streng, hvorfor } of FORBUDT) {
    if (innhold.includes(streng)) {
      mangler.push(`${f.rel} inneholder «${streng}» — ${hvorfor}`);
    }
  }
}

if (mangler.length) {
  console.error("Kan ikke pakke:\n" + mangler.map((m) => `  ✗ ${m}`).join("\n"));
  process.exit(1);
}

const zip = lagZip(filer);
const utfil = join(ROOT, `ordlyd-${BUTIKK}-${manifest.version}.zip`);
writeFileSync(utfil, zip);

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`\n${filer.length} filer, ${mb(ukomprimert)} MB ukomprimert`);
console.log(`ZIP: ${relative(ROOT, utfil)} — ${mb(zip.length)} MB`);
if (zip.length > 100 * 1048576) {
  console.log(
    "\n⚠ Over 100 MB. Microsoft oppgir ingen grense for Edge Add-ons, så vi vet\n" +
      "  ikke hvor taket er — og hver elev laster ned hele pakka ved installasjon.\n" +
      "  Flytt stemme og ordbok til CDN (L4) før dette skal rulles bredt ut.",
  );
}
