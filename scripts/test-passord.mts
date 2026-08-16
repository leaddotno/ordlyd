/**
 * Tester passordkravet for administratorkontoer.
 *
 * Kjør:  pnpm exec tsx scripts/test-passord.mts
 */
import { sjekkPassord, PASSORDKRAV } from "../apps/lisensserver/src/passord.js";

let feil = 0;
let n = 0;

const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

const koder = (p: string, k = {}) => sjekkPassord(p, k).map((f) => f.kode);
const godtar = (p: string, k = {}) => sjekkPassord(p, k).length === 0;

console.log(`Passordkrav: ${PASSORDKRAV}\n`);

/* --- Kravet slik det er bestemt --- */
sjekk("godtar et passord som oppfyller alt", godtar("Fjellrev7!kart"), koder("Fjellrev7!kart"));
sjekk("avviser under ti tegn", koder("Kort1!").includes("kort"));
sjekk("avviser uten tall", koder("Fjellreven!kart").includes("mangler-tall"));
sjekk("avviser uten spesialtegn", koder("Fjellreven7kart").includes("mangler-spesialtegn"));
sjekk("avviser uten bokstaver", koder("1234567890!").includes("mangler-bokstav"));

/* --- Grensen på ti tegn --- */
sjekk("ni tegn avvises", koder("Fjellre1!").includes("kort"), koder("Fjellre1!"));
sjekk("nøyaktig ti tegn godtas", godtar("Fjellrev1!"), koder("Fjellrev1!"));

/* --- Tegn som teller --- */
sjekk("mellomrom teller som spesialtegn", godtar("Fjellrev 1 kart"), koder("Fjellrev 1 kart"));
sjekk("norske bokstaver teller som bokstaver", godtar("Blåbærsyltetøy1!"), koder("Blåbærsyltetøy1!"));
sjekk(
  "tegn utenfor latin teller som bokstav",
  !koder("Χειμώνας7!κάτι").includes("mangler-bokstav"),
  koder("Χειμώνας7!κάτι"),
);

/* --- Bcrypt-grensen på 72 byte --- */
const langt = "Fjellrev1!" + "a".repeat(70);
sjekk("avviser over 72 byte, framfor å la halen bli ignorert", koder(langt).includes("for-langt"));
const emojiTungt = "Fjellrev1!" + "🔑".repeat(20); // 4 byte per emoji
sjekk("teller byte og ikke tegn ved grensen", koder(emojiTungt).includes("for-langt"), Buffer.byteLength(emojiTungt));

/* --- Sperrelisten: nettopp det sammensetningskravet slipper gjennom --- */
sjekk("avviser Sommer2026! selv om det oppfyller alle kravene", koder("Sommer2026!").includes("opplagt"));
sjekk("avviser Passord123!", koder("Passord123!").includes("opplagt"));
sjekk("avviser Ordlyd2026!", koder("Ordlyd2026!").includes("opplagt"));
sjekk("avviser qwerty-rekker", koder("Qwerty123!").includes("opplagt"));
sjekk("lar seg ikke lure av å bytte o med 0", koder("S0mmer2026!").includes("opplagt"));
sjekk("lar seg ikke lure av ø for o", koder("Sømmer2026!").includes("opplagt"), koder("Sømmer2026!"));
sjekk("lar seg ikke lure av oe for ø", koder("Hoest2026!!").includes("opplagt"), koder("Hoest2026!!"));
sjekk(
  "sperrelisten treffer ikke et ord som bare inneholder en stamme lenger inne",
  godtar("Kalvsommer1!"),
  koder("Kalvsommer1!"),
);

/* --- Eget navn og e-post --- */
sjekk(
  "avviser passord som inneholder e-postnavnet",
  koder("Christoffer1!", { epost: "christoffer.corzani@telemarkfylke.no" }).includes("personlig"),
);
sjekk(
  "avviser passord som inneholder fornavnet",
  koder("xCorzani99!", { navn: "Christoffer Corzani" }).includes("personlig"),
);
sjekk(
  "korte navneledd utløser ikke treff",
  godtar("Fjellrev1!kart", { navn: "Bo Li" }),
  koder("Fjellrev1!kart", { navn: "Bo Li" }),
);

/* --- Alle feil samtidig --- */
const alle = koder("abc");
sjekk(
  "rapporterer alle problemer på én gang, ikke ett om gangen",
  alle.includes("kort") && alle.includes("mangler-tall") && alle.includes("mangler-spesialtegn"),
  alle,
);

/* --- Ingen feilmelding lekker passordet --- */
const meldinger = sjekkPassord("Sommer2026!", { epost: "test@eksempel.no" })
  .map((f) => f.melding)
  .join(" ");
sjekk("feilmeldingene gjentar aldri passordet", !meldinger.includes("Sommer2026"));

console.log(feil === 0 ? `\nALLE ${n} OK` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
