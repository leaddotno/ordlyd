/**
 * Tester PNG-lesingen og nedskaleringen.
 * Kjør: node scripts/test-png.mjs
 *
 * Dekoderen er skrevet for hånd, så den fortjener en test: en feil i
 * radfiltrene gir ikke en tydelig krasj, men et bilde som ser subtilt galt
 * ut — nøyaktig den feilen man ikke oppdager før den er i butikken.
 */
import { lesPng, skrivPng, skaler } from "./png.mjs";
import { tegnPlassholder } from "./ikon-plassholder.mjs";
import { deflateSync } from "node:zlib";

let feil = 0;
let n = 0;
const sjekk = (navn, ok, detalj) => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${detalj}`);
};

/* ---------- Rundtur: skriv → les → samme piksler ---------- */
{
  const b = 7;
  const h = 5;
  const rgba = Buffer.alloc(b * h * 4);
  for (let i = 0; i < b * h; i++) {
    rgba[i * 4] = (i * 37) % 256;
    rgba[i * 4 + 1] = (i * 91) % 256;
    rgba[i * 4 + 2] = (i * 13) % 256;
    rgba[i * 4 + 3] = (i * 53) % 256;
  }
  const lest = lesPng(skrivPng(b, h, rgba));
  sjekk("rundtur bevarer størrelse", lest.bredde === b && lest.hoyde === h, `${lest.bredde}×${lest.hoyde}`);
  sjekk("rundtur bevarer hver piksel", Buffer.compare(lest.rgba, rgba) === 0);
}

/* ---------- Alle radfiltrene PNG-spesifikasjonen tillater ---------- */
{
  // Bygger samme bilde fem ganger, ett per filtertype, og krever samme svar.
  const b = 6;
  const h = 4;
  const original = Buffer.alloc(b * h * 4);
  for (let i = 0; i < b * h * 4; i++) original[i] = (i * 29 + 11) % 256;

  function medFilter(filter) {
    const radBytes = b * 4;
    const rader = Buffer.alloc(h * (radBytes + 1));
    let forrige = Buffer.alloc(radBytes);
    for (let y = 0; y < h; y++) {
      const rad = original.subarray(y * radBytes, (y + 1) * radBytes);
      const ut = y * (radBytes + 1);
      rader[ut] = filter;
      for (let i = 0; i < radBytes; i++) {
        const a = i >= 4 ? rad[i - 4] : 0;
        const bb = forrige[i];
        const c = i >= 4 ? forrige[i - 4] : 0;
        let v;
        switch (filter) {
          case 0: v = rad[i]; break;
          case 1: v = rad[i] - a; break;
          case 2: v = rad[i] - bb; break;
          case 3: v = rad[i] - ((a + bb) >> 1); break;
          case 4: {
            const pa = Math.abs(bb - c);
            const pb = Math.abs(a - c);
            const pc = Math.abs(a + bb - 2 * c);
            v = rad[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
            break;
          }
        }
        rader[ut + 1 + i] = v & 0xff;
      }
      forrige = Buffer.from(rad);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(b, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const kropp = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4);
      // Gjenbruker crc32 fra png.mjs via en ny import ville vært renere,
      // men vi trenger den bare her — dekoderen sjekker ikke CRC.
      crc.writeUInt32BE(0);
      return Buffer.concat([len, kropp, crc]);
    };
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(rader)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  for (const f of [0, 1, 2, 3, 4]) {
    const lest = lesPng(medFilter(f));
    sjekk(`filtertype ${f} dekodes riktig`, Buffer.compare(lest.rgba, original) === 0);
  }
}

/* ---------- Nedskalering ---------- */
{
  const stor = lesPng(tegnPlassholder(128));
  const liten = skaler(stor, 32, 32);
  sjekk("nedskalering gir riktig størrelse", liten.bredde === 32 && liten.hoyde === 32);
  sjekk(
    "nedskalert bilde kan skrives og leses tilbake",
    lesPng(skrivPng(32, 32, liten.rgba)).bredde === 32,
  );

  // Høyttalerkroppen ligger rundt x = 0.26 og er hvit. Sentrum av ikonet er
  // derimot bakgrunn — kjeglen slutter ved x = 0.47 — så prøvepunktet må
  // ligge der merket faktisk er.
  const prøve = (16 * 32 + Math.round(0.26 * 32)) * 4;
  sjekk(
    "hvitt merke forblir lyst gjennom skalering",
    liten.rgba[prøve] > 200 && liten.rgba[prøve + 3] > 250,
    `r=${liten.rgba[prøve]} a=${liten.rgba[prøve + 3]}`,
  );
}

/* ---------- Premultiplisering: gjennomsiktig kant skal ikke mørkne ---------- */
{
  // Halv rød, halv gjennomsiktig hvit. Uten premultiplisering blir
  // resultatet dratt mot hvit; med premultiplisering forblir fargen rød.
  const b = 4;
  const rgba = Buffer.alloc(b * 1 * 4);
  for (let x = 0; x < b; x++) {
    const i = x * 4;
    if (x < 2) {
      rgba[i] = 255; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 255;
    } else {
      rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = 0;
    }
  }
  const liten = skaler({ bredde: b, hoyde: 1, rgba }, 2, 1);
  // Første utpiksel dekker de to røde: skal være rent rødt.
  sjekk(
    "helt dekkende område beholder fargen",
    liten.rgba[0] === 255 && liten.rgba[1] === 0 && liten.rgba[2] === 0,
    `rgb=${liten.rgba[0]},${liten.rgba[1]},${liten.rgba[2]}`,
  );
  // Andre utpiksel dekker de gjennomsiktige: alfa 0.
  sjekk("helt gjennomsiktig område forblir gjennomsiktig", liten.rgba[7] === 0, `a=${liten.rgba[7]}`);
}

/* ---------- Feilmeldinger ---------- */
{
  try {
    lesPng(Buffer.from("ikke en png"));
    sjekk("ikke-PNG avvises", false);
  } catch (e) {
    sjekk("ikke-PNG avvises med forståelig feil", e.message.includes("ikke en PNG"), e.message);
  }
}

console.log(feil === 0 ? `\nALLE OK (${n} tester)` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
