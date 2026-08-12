/**
 * Tekstnormalisering før talesyntese.
 *
 * To jobber:
 *  1. Skriv om det som IKKE er uttalefeil, men uforståelig tekst for en
 *     talesyntese: forkortelser, klokkeslett, datoer, tusenskilletegn,
 *     enheter og symboler.
 *  2. Uttale-overstyringer: ord fonemiseringen (espeak-ng) uttaler feil,
 *     skrevet om til en lydrett staving («journalist» → «sjurnalist»).
 *     Listen bor i en redigerbar JSON (dict/uttale-overrides.json) og
 *     vokser etter hvert som feiluttalte ord rapporteres — samme grep
 *     som kommersielle systemer bruker med sine uttaleleksikon.
 *
 * Normaliseringen brukes KUN på teksten som sendes til syntesen —
 * ordmarkeringen på siden bruker fortsatt originalteksten.
 */

const ABBREVIATIONS: Record<string, string> = {
  "bl.a.": "blant annet",
  "f.eks.": "for eksempel",
  "dvs.": "det vil si",
  "osv.": "og så videre",
  "ca.": "cirka",
  "mht.": "med hensyn til",
  "pga.": "på grunn av",
  "ifm.": "i forbindelse med",
  "iht.": "i henhold til",
  "ift.": "i forhold til",
  "iflg.": "ifølge",
  "jf.": "jamfør",
  "m.m.": "med mer",
  "m.a.o.": "med andre ord",
  "o.l.": "og lignende",
  "nr.": "nummer",
  "tlf.": "telefon",
  "evt.": "eventuelt",
  "ang.": "angående",
  "vedr.": "vedrørende",
  "inkl.": "inkludert",
  "ekskl.": "ekskludert",
  "mill.": "millioner",
  "mrd.": "milliarder",
  "stk.": "stykk",
  "etg.": "etasje",
  "f.o.m.": "fra og med",
  "t.o.m.": "til og med",
  "kl.": "klokka",
  "mvh": "med vennlig hilsen",
  "kap.": "kapittel",
  "pkt.": "punkt",
  "hhv.": "henholdsvis",
  "vha.": "ved hjelp av",
  "avd.": "avdeling",
};

const MONTHS = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];

/** Ord → lydrett staving. Utvides via setPronunciationOverrides. */
let overrides = new Map<string, string>();
let overrideRegex: RegExp | null = null;

export function setPronunciationOverrides(map: Record<string, string>): void {
  // Nøkler med _ er metadata (f.eks. _kommentar i JSON-fila)
  overrides = new Map(
    Object.entries(map)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => [k.toLowerCase(), v]),
  );
  overrideRegex =
    overrides.size > 0
      ? new RegExp(
          `(?<![\\p{L}\\p{N}])(${[...overrides.keys()]
            .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")})(?![\\p{L}\\p{N}])`,
          "giu",
        )
      : null;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Oppslag på både «f.eks.» og «f.eks» — folk sløyfer ofte det avsluttende
 * punktumet, og da skal forkortelsen likevel leses ut.
 */
const ABBREV_LOOKUP = new Map<string, string>();
for (const [key, value] of Object.entries(ABBREVIATIONS)) {
  const lower = key.toLowerCase();
  ABBREV_LOOKUP.set(lower, value);
  ABBREV_LOOKUP.set(lower.replace(/\.$/, ""), value);
}

const ABBREV_REGEX = new RegExp(
  `(?<![\\p{L}\\p{N}.])(${Object.keys(ABBREVIATIONS)
    .map((k) => k.toLowerCase().replace(/\.$/, "")) // stamme uten sluttpunktum
    .sort((a, b) => b.length - a.length) // lengste først («f.o.m.» før «f.»-kollisjoner)
    .map((stem) => `${escapeForRegex(stem)}\\.?`)
    .join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

export function normalizeForSpeech(text: string): string {
  let s = text;

  // Forkortelser → fulle ord
  s = s.replace(ABBREV_REGEX, (m) => ABBREV_LOOKUP.get(m.toLowerCase()) ?? m);

  // Dato dd.mm.yyyy → «17. mai 2026» (månedsnavn leses alltid riktig).
  // Tosifret årstall godtas også («17.05.26»).
  s = s.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/g, (m, d, mnd, y) => {
    const day = Number(d);
    const mi = Number(mnd);
    if (day < 1 || day > 31 || mi < 1 || mi > 12) return m;
    return `${day}. ${MONTHS[mi - 1]} ${y}`;
  });

  // Klokkeslett 14:30 → «14 30» (leses «fjorten tretti»)
  s = s.replace(/\b(\d{1,2}):(\d{2})\b/g, "$1 $2");

  // Tusenskille med punktum: 2.500 → 2500, 2.500.000 → 2500000
  // (ellers leses gruppene som desimaltall)
  s = s.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (m) => m.replace(/\./g, ""));

  // Enheter og symboler
  s = s.replace(/\bkm\/t\b/gi, "kilometer i timen");
  s = s.replace(/(\d)\s*%/g, "$1 prosent");
  s = s.replace(/(\d)\s*°C\b/g, "$1 grader");
  s = s.replace(/(\d)\s*kr\b/gi, "$1 kroner");
  s = s.replace(/\s&\s/g, " og ");
  s = s.replace(/§\s*(\d)/g, "paragraf $1");

  // Uttale-overstyringer (lydrett staving)
  if (overrideRegex) {
    s = s.replace(overrideRegex, (m) => overrides.get(m.toLowerCase()) ?? m);
  }

  return s.replace(/\s+/g, " ").trim();
}
