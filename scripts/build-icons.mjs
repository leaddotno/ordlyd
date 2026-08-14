/**
 * Lager utvidelsens ikoner fra merkevareikonet.
 *
 * Kilde: brand/ikon.png — én kvadratisk PNG i høy oppløsning (512 px eller
 * mer). Alle størrelsene utvidelsen og butikken trenger skaleres ned fra
 * den, så det finnes bare én fil å holde oppdatert.
 *
 * Valgfri overstyring: brand/ikon-16.png. Et detaljert merke blir grøt ved
 * 16 piksler uansett hvor godt man skalerer, så finnes den filen brukes den
 * i stedet for en nedskalering. 16 px er størrelsen folk faktisk ser i
 * verktøylinja, så det er verdt å kunne tegne den for hånd.
 *
 * Kjør: node scripts/build-icons.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lesPng, skalerPngTilFil, tilKvadrat } from "./png-hjelp.mjs";
import { tegnPlassholder } from "./ikon-plassholder.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "brand");
const IKON_KILDE = join(BRAND, "ikon.png");
const LOGO_KILDE = join(BRAND, "logo.png");
const IKON_UT = join(ROOT, "apps", "extension", "public", "icons");
const BRAND_UT = join(ROOT, "apps", "extension", "public", "brand");

const STORRELSER = [16, 32, 48, 128];

mkdirSync(IKON_UT, { recursive: true });
mkdirSync(BRAND_UT, { recursive: true });

const harMerke = existsSync(IKON_KILDE);

if (!harMerke) {
  // Bygget skal aldri stoppe fordi en merkevarefil mangler, men det skal
  // være umulig å ikke legge merke til at plassholderen er i bruk.
  console.warn(
    `⚠ PLASSHOLDERIKON I BRUK — brand/ikon.png finnes ikke.\n\n` +
      `  Legg ikonet som:  brand/ikon.png\n` +
      `  Kvadratisk PNG, minst 512×512, 8 bit per kanal, ikke interlaced.\n\n` +
      `  Valgfritt:        brand/ikon-16.png  (håndtegnet 16 px-variant)\n` +
      `                    brand/logo.png     (logo med ordmerke, vises i panelet)\n`,
  );
  for (const s of [...STORRELSER, 300]) {
    const mål = s === 300 ? join(BRAND_UT, "butikklogo-300.png") : join(IKON_UT, `icon-${s}.png`);
    writeFileSync(mål, tegnPlassholder(s));
  }
  console.log(`Skrev plassholder i ${STORRELSER.join(", ")} og 300 px.`);
} else {
  const lest = lesPng(readFileSync(IKON_KILDE));
  console.log(`Kilde: brand/ikon.png (${lest.bredde}×${lest.hoyde})`);

  // Ikoner MÅ være kvadratiske. Fyll ut med gjennomsiktig luft framfor å
  // strekke motivet.
  const kilde = tilKvadrat(lest);
  if (kilde.bredde !== lest.bredde || kilde.hoyde !== lest.hoyde) {
    console.log(`  → fylt ut til ${kilde.bredde}×${kilde.hoyde} med gjennomsiktig luft, motivet sentrert`);
  }

  const største = Math.max(...STORRELSER, 300);
  if (kilde.bredde < største) {
    console.warn(
      `\n⚠ Kilden er ${kilde.bredde} px, men butikklogoen skal være 300 px.\n` +
        `  Den blir oppskalert og dermed litt uskarp. Har du ikonet i høyere\n` +
        `  oppløsning (512 px eller mer), gir det et merkbart skarpere resultat\n` +
        `  — særlig i butikklisten der logoen vises stor.`,
    );
  }
  console.log("");

  for (const s of STORRELSER) {
    const overstyring = join(BRAND, `ikon-${s}.png`);
    const mål = join(IKON_UT, `icon-${s}.png`);
    if (existsSync(overstyring)) {
      copyFileSync(overstyring, mål);
      console.log(`${String(s).padStart(3)} px ← brand/ikon-${s}.png (håndtegnet)`);
    } else {
      const bytes = skalerPngTilFil(kilde, s, s, mål);
      console.log(`${String(s).padStart(3)} px ← nedskalert (${bytes} B)`);
    }
  }

  // Butikkens logo skal være 300×300; lages fra samme kilde.
  const bl = skalerPngTilFil(kilde, 300, 300, join(BRAND_UT, "butikklogo-300.png"));
  console.log(`300 px ← butikklogo til Partner Center (${bl} B)`);
}

if (existsSync(LOGO_KILDE)) {
  copyFileSync(LOGO_KILDE, join(BRAND_UT, "logo.png"));
  const l = lesPng(readFileSync(LOGO_KILDE));
  console.log(`\nLogo: brand/logo.png (${l.bredde}×${l.hoyde}) → vises i popup og «Om Ordlyd»`);
} else {
  console.warn(
    `\n⚠ Mangler brand/logo.png — panelet viser navnet som tekst i stedet.\n` +
      `  Legg inn logoen med ordmerket der, og bygg på nytt.`,
  );
}
