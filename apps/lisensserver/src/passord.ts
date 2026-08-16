/**
 * Passordkravet for administratorkontoer.
 *
 * Avgjort krav: minst 10 tegn, bokstaver, minst ett tall og minst ett
 * spesialtegn. Ingen kontroll mot lekkede passordbaser, ingen tvungen
 * rullering.
 *
 * Kravet håndheves her og ikke i Supabase-innstillingene, av to grunner:
 * feilmeldingen skal være på norsk og si nøyaktig hva som mangler, og
 * regelen skal være testbar uten å spørre en ekstern tjeneste.
 *
 * Om sperrelisten: sammensetningskrav slipper gjennom nettopp de
 * passordene en angriper prøver først. «Sommer2026!» oppfyller hvert
 * eneste krav over — ti tegn, bokstaver, tall og spesialtegn — og står
 * i alle ordlister. Listen under koster ingenting og fanger den klassen.
 * Den kan tømmes uten at noe annet må endres.
 */

/** Bcrypt, som Supabase bruker, ser bare de første 72 bytene. */
const MAKS_BYTE = 72;
const MIN_TEGN = 10;

export interface Passordfeil {
  kode: "kort" | "mangler-bokstav" | "mangler-tall" | "mangler-spesialtegn" | "for-langt" | "opplagt" | "personlig";
  melding: string;
}

/**
 * Stammer som gjør et passord gjettbart uansett hva som henges på.
 * Sammenlignes mot passordet med tall og spesialtegn fjernet, slik at
 * «Sommer2026!», «s0mmer!» og «SOMMER###» alle treffer «sommer».
 */
const OPPLAGTE_STAMMER = [
  // Årstider og måneder
  "vaar", "var", "sommer", "host", "hoest", "vinter",
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
  // Det aller vanligste
  "passord", "password", "passwd", "hemmelig", "secret",
  "velkommen", "welcome", "brukernavn", "admin", "administrator",
  "test", "prove", "proeve", "demo", "standard", "endremeg",
  // Produkt og sted — de første folk prøver på nettopp dette systemet
  "ordlyd", "lisens", "telemark", "fylke", "fylkeskommune",
  "dysleksi", "skrivestotte", "skrivestoette",
  // Tastaturrekker
  "qwerty", "qwertz", "asdf", "zxcv", "qazwsx", "123456", "abcdef",
  // Norske allmennord som dukker opp i alle lekkasjelister
  "norge", "norsk", "oslo", "bergen", "trondheim", "skien", "porsgrunn",
  "fotball", "kjaerlighet", "kjerlighet", "familie", "sommerferie",
];

const HAR_BOKSTAV = /\p{L}/u;
const HAR_TALL = /\p{Nd}/u;
/** Alt som verken er bokstav eller tall regnes som spesialtegn — også mellomrom. */
const HAR_SPESIALTEGN = /[^\p{L}\p{Nd}]/u;

/**
 * Tall og tegn som brukes som bokstavererstatning. Uten denne
 * oversettelsen ville «S0mmer2026!» blitt til «smmer» når tallene bare
 * strippes, og dermed gått klar av sperrelisten — altså akkurat det
 * trikset lista skal fange.
 *
 * `1` er tvetydig (i eller l), så den behandles med to varianter i
 * stammer() framfor å gjettes her.
 */
const LEET: Record<string, string> = {
  "0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s",
};

function tilBokstaver(tekst: string): string {
  return tekst
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "aa")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Skrivemåter av samme ord, alt annet enn bokstaver fjernet. Returnerer
 * flere varianter fordi `1` kan stå for både i og l.
 */
function stammer(tekst: string): string[] {
  const grunn = tilBokstaver(tekst);
  const leet = grunn.replace(/[03457 8@$]/g, (c) => LEET[c] ?? c);
  const reduser = (s: string) => s.replace(/[^a-z]/g, "");
  return [
    reduser(grunn),
    reduser(leet.replace(/1/g, "i")),
    reduser(leet.replace(/1/g, "l")),
  ];
}

/** Første variant brukes der én representasjon holder. */
const stamme = (tekst: string): string => stammer(tekst)[0];

export interface PassordKontekst {
  epost?: string;
  navn?: string;
}

/**
 * Returnerer alle problemer med passordet. Tom liste betyr godkjent.
 *
 * Alle feil returneres samtidig med vilje — å oppdage kravene ett om
 * gangen er en dårlig opplevelse for den som prøver å velge et passord,
 * og det er samme opplevelse uansett om kontoen finnes eller ikke.
 */
export function sjekkPassord(passord: string, kontekst: PassordKontekst = {}): Passordfeil[] {
  const feil: Passordfeil[] = [];

  if ([...passord].length < MIN_TEGN) {
    feil.push({ kode: "kort", melding: `Passordet må være minst ${MIN_TEGN} tegn.` });
  }
  if (Buffer.byteLength(passord, "utf8") > MAKS_BYTE) {
    feil.push({
      kode: "for-langt",
      melding:
        `Passordet er for langt (maks ${MAKS_BYTE} byte). Lagringen ville ellers ignorert ` +
        "resten uten å si fra, så det er bedre å velge et kortere.",
    });
  }
  if (!HAR_BOKSTAV.test(passord)) {
    feil.push({ kode: "mangler-bokstav", melding: "Passordet må inneholde bokstaver." });
  }
  if (!HAR_TALL.test(passord)) {
    feil.push({ kode: "mangler-tall", melding: "Passordet må inneholde minst ett tall." });
  }
  if (!HAR_SPESIALTEGN.test(passord)) {
    feil.push({
      kode: "mangler-spesialtegn",
      melding: "Passordet må inneholde minst ett spesialtegn, for eksempel ! ? - _ eller .",
    });
  }

  const varianter = stammer(passord).filter((v) => v.length >= 3);
  if (varianter.some((v) => OPPLAGTE_STAMMER.some((o) => v === o || v.startsWith(o)))) {
    feil.push({
      kode: "opplagt",
      melding:
        "Passordet bygger på et ord som står øverst på enhver gjetteliste. " +
        "Å legge til tall og tegn hjelper ikke — velg et annet ord.",
    });
  }

  // Eget navn eller e-postadresse i passordet er blant de første tingene
  // som prøves når angriperen vet hvem kontoen tilhører.
  // Adressen deles opp: «christoffer.corzani» skal gi både «christoffer»
  // og «corzani», ikke bare den sammenslåtte formen.
  const egne = [
    ...(kontekst.epost?.split("@")[0]?.split(/[^\p{L}\p{Nd}]+/u) ?? []),
    ...(kontekst.navn?.split(/[^\p{L}\p{Nd}]+/u) ?? []),
  ]
    .map((d) => (d ? stamme(d) : ""))
    .filter((d) => d.length >= 4);
  if (egne.some((d) => stammer(passord).some((v) => v.includes(d)))) {
    feil.push({
      kode: "personlig",
      melding: "Passordet inneholder navnet eller e-postadressen din. Velg noe uten.",
    });
  }

  return feil;
}

/** Kort sammendrag til visning over passordfeltet. */
export const PASSORDKRAV =
  `Minst ${MIN_TEGN} tegn, med bokstaver, minst ett tall og minst ett spesialtegn.`;
