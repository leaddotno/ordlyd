/** Bindeledd mellom png.mjs og byggeskriptene. */
import { writeFileSync } from "node:fs";
import { lesPng, skrivPng, skaler } from "./png.mjs";

export { lesPng, skrivPng, skaler };

/** Skalerer et lest bilde og skriver det til fil. Returnerer antall byte. */
export function skalerPngTilFil(kilde, bredde, hoyde, mål) {
  const liten = skaler(kilde, bredde, hoyde);
  const png = skrivPng(liten.bredde, liten.hoyde, liten.rgba);
  writeFileSync(mål, png);
  return png.length;
}
