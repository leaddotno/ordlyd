/**
 * Lager panelets logofiler fra originalen i brand/.
 *
 * Originalen er 1015 px bred og 164 kB. Topplinja viser den i rundt
 * 150 px, så full oppløsning er ren ballast på hver sidelasting — og
 * panelet lastes mange ganger om dagen av folk som jobber i det.
 *
 * To bredder: 1x for vanlige skjermer og 2x for skjermer med høy
 * pikseltetthet, valgt av nettleseren gjennom srcset.
 *
 * Kjør:  node scripts/build-panel-logo.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { lesPng, skrivPng, skaler, tilKvadrat } from "./png.mjs";

const UT = "apps/lisensserver/public/admin";

function lag(kilde, mål, bredde) {
  const png = lesPng(readFileSync(kilde));
  const høyde = Math.round((png.hoyde / png.bredde) * bredde);
  const skalert = skaler(png, bredde, høyde);
  const data = skrivPng(skalert.bredde, skalert.hoyde, skalert.rgba);
  writeFileSync(mål, data);
  console.log(
    `${mål}  ${skalert.bredde}×${skalert.hoyde}  ${Math.round(data.length / 1024)} kB` +
      `  (fra ${png.bredde}×${png.hoyde})`,
  );
}

lag("brand/logo.png", `${UT}/logo.png`, 320);
lag("brand/logo.png", `${UT}/logo@2x.png`, 640);

// Fanikonet. Kvadreres først, ellers strekkes det ikke-kvadratiske
// merket når nettleseren tvinger det inn i en kvadratisk fane.
{
  const kvadrat = tilKvadrat(lesPng(readFileSync("brand/ikon.png")));
  const liten = skaler(kvadrat, 64, 64);
  const data = skrivPng(liten.bredde, liten.hoyde, liten.rgba);
  writeFileSync(`${UT}/ikon.png`, data);
  console.log(`${UT}/ikon.png  64×64  ${Math.round(data.length / 1024)} kB`);
}
