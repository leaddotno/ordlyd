/**
 * Genererer utvidelsens ikoner som PNG — uten bildebibliotek.
 *
 * Node har zlib innebygd, og en PNG er ikke stort mer enn en zlib-pakket
 * rad av piksler med noen sjekksummer rundt. Å tegne formene matematisk
 * gir dessuten noe et bildeverktøy ikke gir gratis: full kontroll over
 * hvordan merket ser ut ved 16 piksler, som er størrelsen folk faktisk ser
 * i verktøylinja.
 *
 * Merket: en høyttaler med to lydbuer — samme bilde som 🔊 i popup, så
 * utvidelsen kjennes igjen. Formene er definert i normaliserte koordinater
 * (0–1) og tegnes med 4× oversampling for jevne kanter.
 *
 * Kjør: node scripts/build-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UT = join(ROOT, "apps", "extension", "public", "icons");

/** Dyp petrol som i dokumentene våre, og rent hvitt merke oppå. */
const BAKGRUNN = [14, 61, 67];
const MERKE = [255, 255, 255];

const STORRELSER = [16, 32, 48, 128];
const OVERSAMPLING = 4;

/* ---------------------------------------------------------------- former */

/** Avrundet kvadrat som dekker hele flaten. */
function iAvrundetFirkant(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  if (dx === 0 || dy === 0) return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Høyttaleren: en kropp og en kjegle som åpner mot høyre.
 *
 * To geometrier, ikke én skalert: ved 16 px dropper vi lydbuene, og da må
 * høyttaleren fylle plassen selv og stå midt i flaten. Skalerer man bare
 * ned den store varianten, blir merket en klump i venstre halvdel med tomt
 * rom der buene skulle vært.
 */
function iHoyttaler(x, y, kompakt) {
  const g = kompakt
    ? { kroppFra: 0.26, kroppTil: 0.45, kroppHalv: 0.115, kjegleTil: 0.71, kjegleHalv: 0.30 }
    : { kroppFra: 0.20, kroppTil: 0.33, kroppHalv: 0.09, kjegleTil: 0.47, kjegleHalv: 0.24 };

  if (x >= g.kroppFra && x <= g.kroppTil && Math.abs(y - 0.5) <= g.kroppHalv) return true;
  // Kjegle: bredden vokser lineært fra kroppen og utover
  if (x >= g.kroppTil && x <= g.kjegleTil) {
    const t = (x - g.kroppTil) / (g.kjegleTil - g.kroppTil);
    return Math.abs(y - 0.5) <= g.kroppHalv + t * (g.kjegleHalv - g.kroppHalv);
  }
  return false;
}

/** Lydbue til høyre for høyttaleren. */
function iBue(x, y, radius, tykkelse) {
  const dx = x - 0.47;
  const dy = y - 0.5;
  const avstand = Math.hypot(dx, dy);
  if (Math.abs(avstand - radius) > tykkelse / 2) return false;
  // Bare den høyre delen av sirkelen, ±55° fra vannrett
  if (dx <= 0) return false;
  return Math.abs(Math.atan2(dy, dx)) <= (55 * Math.PI) / 180;
}

/**
 * Ved 16 px er to buer og en tynn kjegle bare grums. Da tegner vi kun
 * høyttaleren, litt kraftigere — det er bedre å være tydelig enn komplett.
 */
function merkeDekning(x, y, storrelse) {
  const kompakt = storrelse <= 16;
  if (iHoyttaler(x, y, kompakt)) return true;
  if (kompakt) return false;
  const tykkelse = storrelse >= 48 ? 0.055 : 0.07;
  return iBue(x, y, 0.19, tykkelse) || (storrelse >= 32 && iBue(x, y, 0.30, tykkelse));
}

/* ------------------------------------------------------------------- PNG */

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

function chunk(type, data) {
  const lengde = Buffer.alloc(4);
  lengde.writeUInt32BE(data.length);
  const kropp = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const sjekksum = Buffer.alloc(4);
  sjekksum.writeUInt32BE(crc32(kropp));
  return Buffer.concat([lengde, kropp, sjekksum]);
}

function pngFraRgba(bredde, hoyde, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bredde, 0);
  ihdr.writeUInt32BE(hoyde, 4);
  ihdr[8] = 8; // bitdybde
  ihdr[9] = 6; // fargetype: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // standard filter
  ihdr[12] = 0; // ingen interlacing

  // Hver rad prefikses med filtertype 0 (ingen filtrering)
  const rader = Buffer.alloc(hoyde * (1 + bredde * 4));
  for (let y = 0; y < hoyde; y++) {
    const inn = y * bredde * 4;
    const ut = y * (1 + bredde * 4);
    rader[ut] = 0;
    rgba.copy(rader, ut + 1, inn, inn + bredde * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rader, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- tegning */

function tegnIkon(storrelse) {
  const rgba = Buffer.alloc(storrelse * storrelse * 4);
  const radius = 0.22;
  const steg = 1 / (storrelse * OVERSAMPLING);

  for (let py = 0; py < storrelse; py++) {
    for (let px = 0; px < storrelse; px++) {
      let bakgrunnTreff = 0;
      let merkeTreff = 0;
      for (let sy = 0; sy < OVERSAMPLING; sy++) {
        for (let sx = 0; sx < OVERSAMPLING; sx++) {
          const x = (px + (sx + 0.5) / OVERSAMPLING) / storrelse;
          const y = (py + (sy + 0.5) / OVERSAMPLING) / storrelse;
          if (!iAvrundetFirkant(x, y, radius)) continue;
          bakgrunnTreff++;
          if (merkeDekning(x, y, storrelse)) merkeTreff++;
        }
      }
      const total = OVERSAMPLING * OVERSAMPLING;
      const alfa = bakgrunnTreff / total;
      const merkeAndel = bakgrunnTreff ? merkeTreff / bakgrunnTreff : 0;

      const i = (py * storrelse + px) * 4;
      for (let k = 0; k < 3; k++) {
        rgba[i + k] = Math.round(BAKGRUNN[k] + (MERKE[k] - BAKGRUNN[k]) * merkeAndel);
      }
      rgba[i + 3] = Math.round(alfa * 255);
    }
  }
  return pngFraRgba(storrelse, storrelse, rgba);
}

mkdirSync(UT, { recursive: true });
for (const s of STORRELSER) {
  const png = tegnIkon(s);
  const fil = join(UT, `icon-${s}.png`);
  writeFileSync(fil, png);
  console.log(`${String(s).padStart(3)} px → icons/icon-${s}.png (${png.length} B)`);
}
console.log("\nFerdig. Byttes ut med egen logo ved å legge nye PNG-er i samme mappe.");
