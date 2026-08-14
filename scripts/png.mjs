/**
 * Minimal PNG-lesing og -skriving med Nodes innebygde zlib.
 *
 * Finnes for at merkevareikonet skal kunne være ÉN kildefil: legg inn én
 * PNG i høy oppløsning, og byggetrinnet lager alle størrelsene utvidelsen
 * og butikken trenger. Alternativet — fire filer vedlikeholdt for hånd —
 * blir før eller senere fire filer som ikke er samme ikon.
 *
 * Støtter det eksportverktøy faktisk lager: 8 bits per kanal, ikke
 * interlaced, fargetype 0/2/4/6. Alt annet gir en tydelig feilmelding
 * framfor et ødelagt bilde.
 */
import { deflateSync, inflateSync } from "node:zlib";

const CRC_TABELL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
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

/** Skriver RGBA-piksler som PNG. */
export function skrivPng(bredde, hoyde, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bredde, 0);
  ihdr.writeUInt32BE(hoyde, 4);
  ihdr[8] = 8; // bitdybde
  ihdr[9] = 6; // RGBA
  const rader = Buffer.alloc(hoyde * (1 + bredde * 4));
  for (let y = 0; y < hoyde; y++) {
    const inn = y * bredde * 4;
    const ut = y * (1 + bredde * 4);
    rader[ut] = 0; // filtertype: ingen
    rgba.copy(rader, ut + 1, inn, inn + bredde * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rader, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Leser en PNG til { bredde, hoyde, rgba }. */
export function lesPng(buf) {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("ikke en PNG-fil");
  }

  let bredde = 0;
  let hoyde = 0;
  let bitdybde = 0;
  let fargetype = 0;
  let interlaced = 0;
  let palett = null;
  let palettAlfa = null;
  const idat = [];

  let p = 8;
  while (p < buf.length) {
    const lengde = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString("ascii");
    const data = buf.subarray(p + 8, p + 8 + lengde);
    if (type === "IHDR") {
      bredde = data.readUInt32BE(0);
      hoyde = data.readUInt32BE(4);
      bitdybde = data[8];
      fargetype = data[9];
      interlaced = data[12];
    } else if (type === "PLTE") {
      palett = Buffer.from(data);
    } else if (type === "tRNS") {
      palettAlfa = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    p += 12 + lengde;
  }

  if (bitdybde !== 8) throw new Error(`bitdybde ${bitdybde} støttes ikke — eksporter som 8 bit per kanal`);
  if (interlaced) throw new Error("interlaced PNG støttes ikke — eksporter uten interlacing");

  const kanaler = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[fargetype];
  if (!kanaler) throw new Error(`fargetype ${fargetype} støttes ikke`);
  if (fargetype === 3 && !palett) throw new Error("palettbilde uten PLTE");

  const rå = inflateSync(Buffer.concat(idat));
  const radBytes = bredde * kanaler;
  const ut = Buffer.alloc(bredde * hoyde * 4);
  let forrige = Buffer.alloc(radBytes);

  for (let y = 0; y < hoyde; y++) {
    const filter = rå[y * (radBytes + 1)];
    const rad = Buffer.from(rå.subarray(y * (radBytes + 1) + 1, (y + 1) * (radBytes + 1)));

    // Reverser radfilteret. Rekkefølgen er gitt av PNG-spesifikasjonen.
    for (let i = 0; i < radBytes; i++) {
      const a = i >= kanaler ? rad[i - kanaler] : 0;
      const b = forrige[i];
      const c = i >= kanaler ? forrige[i - kanaler] : 0;
      switch (filter) {
        case 0: break;
        case 1: rad[i] = (rad[i] + a) & 0xff; break;
        case 2: rad[i] = (rad[i] + b) & 0xff; break;
        case 3: rad[i] = (rad[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          rad[i] = (rad[i] + pred) & 0xff;
          break;
        }
        default: throw new Error(`ukjent filtertype ${filter}`);
      }
    }

    for (let x = 0; x < bredde; x++) {
      const s = x * kanaler;
      const d = (y * bredde + x) * 4;
      if (fargetype === 6) {
        rad.copy(ut, d, s, s + 4);
      } else if (fargetype === 2) {
        ut[d] = rad[s]; ut[d + 1] = rad[s + 1]; ut[d + 2] = rad[s + 2]; ut[d + 3] = 255;
      } else if (fargetype === 0) {
        ut[d] = ut[d + 1] = ut[d + 2] = rad[s]; ut[d + 3] = 255;
      } else if (fargetype === 4) {
        ut[d] = ut[d + 1] = ut[d + 2] = rad[s]; ut[d + 3] = rad[s + 1];
      } else {
        const i = rad[s] * 3;
        ut[d] = palett[i]; ut[d + 1] = palett[i + 1]; ut[d + 2] = palett[i + 2];
        ut[d + 3] = palettAlfa?.[rad[s]] ?? 255;
      }
    }
    forrige = rad;
  }

  return { bredde, hoyde, rgba: ut };
}

/**
 * Utvider bildet til et kvadrat ved å legge gjennomsiktig luft rundt, med
 * motivet sentrert.
 *
 * Alternativet — å skalere et ikke-kvadratisk bilde rett til 128×128 —
 * strekker motivet. Et bokmerke som er 270×261 blir da 3 % bredere enn det
 * skal være, og selv om det er lite nok å ikke se ved første øyekast, er
 * det synlig når ikonet står ved siden av andre ikoner i verktøylinja.
 */
export function tilKvadrat(kilde) {
  const { bredde, hoyde, rgba } = kilde;
  if (bredde === hoyde) return kilde;

  const side = Math.max(bredde, hoyde);
  const ut = Buffer.alloc(side * side * 4);
  const xOff = Math.round((side - bredde) / 2);
  const yOff = Math.round((side - hoyde) / 2);

  for (let y = 0; y < hoyde; y++) {
    const fra = y * bredde * 4;
    const til = ((y + yOff) * side + xOff) * 4;
    rgba.copy(ut, til, fra, fra + bredde * 4);
  }
  return { bredde: side, hoyde: side, rgba: ut };
}

/**
 * Nedskalering med boksfilter i premultiplisert alfa.
 *
 * Premultiplisering er poenget: skalerer man RGB og alfa hver for seg, vil
 * gjennomsiktige piksler dra fargen sin inn i naboene og legge en mørk
 * kant rundt hele merket. Ikonet vårt har avrundede hjørner, så det ville
 * vært synlig.
 */
export function skaler(kilde, nyBredde, nyHoyde) {
  const { bredde, hoyde, rgba } = kilde;
  const ut = Buffer.alloc(nyBredde * nyHoyde * 4);
  const xSkala = bredde / nyBredde;
  const ySkala = hoyde / nyHoyde;

  for (let y = 0; y < nyHoyde; y++) {
    const y0 = Math.floor(y * ySkala);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ySkala));
    for (let x = 0; x < nyBredde; x++) {
      const x0 = Math.floor(x * xSkala);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xSkala));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < Math.min(y1, hoyde); sy++) {
        for (let sx = x0; sx < Math.min(x1, bredde); sx++) {
          const i = (sy * bredde + sx) * 4;
          const alfa = rgba[i + 3] / 255;
          r += rgba[i] * alfa;
          g += rgba[i + 1] * alfa;
          b += rgba[i + 2] * alfa;
          a += alfa;
          n++;
        }
      }
      const d = (y * nyBredde + x) * 4;
      if (a > 0) {
        ut[d] = Math.round(r / a);
        ut[d + 1] = Math.round(g / a);
        ut[d + 2] = Math.round(b / a);
        ut[d + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return { bredde: nyBredde, hoyde: nyHoyde, rgba: ut };
}
