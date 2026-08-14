/**
 * Plassholderikon — brukes bare når brand/ikon.png ikke finnes ennå.
 *
 * Tegner en høyttaler matematisk, så repoet alltid bygger til noe som ser
 * ut som et ikon. Blir erstattet av det ekte merket i det filen legges inn.
 */
import { skrivPng } from "./png.mjs";

const BAKGRUNN = [14, 61, 67];
const MERKE = [255, 255, 255];
const OVERSAMPLING = 4;

function iAvrundetFirkant(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  if (dx === 0 || dy === 0) return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  return dx * dx + dy * dy <= radius * radius;
}

function iHoyttaler(x, y) {
  if (x >= 0.20 && x <= 0.33 && Math.abs(y - 0.5) <= 0.09) return true;
  if (x >= 0.33 && x <= 0.47) {
    const t = (x - 0.33) / 0.14;
    return Math.abs(y - 0.5) <= 0.09 + t * 0.15;
  }
  return false;
}

function iBue(x, y, radius, tykkelse) {
  const dx = x - 0.47;
  const dy = y - 0.5;
  if (dx <= 0) return false;
  if (Math.abs(Math.hypot(dx, dy) - radius) > tykkelse / 2) return false;
  return Math.abs(Math.atan2(dy, dx)) <= (55 * Math.PI) / 180;
}

/** Returnerer en PNG-buffer med plassholderikonet i gitt størrelse. */
export function tegnPlassholder(storrelse) {
  const rgba = Buffer.alloc(storrelse * storrelse * 4);
  const total = OVERSAMPLING * OVERSAMPLING;

  for (let py = 0; py < storrelse; py++) {
    for (let px = 0; px < storrelse; px++) {
      let bak = 0;
      let merke = 0;
      for (let sy = 0; sy < OVERSAMPLING; sy++) {
        for (let sx = 0; sx < OVERSAMPLING; sx++) {
          const x = (px + (sx + 0.5) / OVERSAMPLING) / storrelse;
          const y = (py + (sy + 0.5) / OVERSAMPLING) / storrelse;
          if (!iAvrundetFirkant(x, y, 0.22)) continue;
          bak++;
          if (iHoyttaler(x, y) || iBue(x, y, 0.19, 0.055) || iBue(x, y, 0.3, 0.055)) merke++;
        }
      }
      const andel = bak ? merke / bak : 0;
      const i = (py * storrelse + px) * 4;
      for (let k = 0; k < 3; k++) {
        rgba[i + k] = Math.round(BAKGRUNN[k] + (MERKE[k] - BAKGRUNN[k]) * andel);
      }
      rgba[i + 3] = Math.round((bak / total) * 255);
    }
  }
  return skrivPng(storrelse, storrelse, rgba);
}
