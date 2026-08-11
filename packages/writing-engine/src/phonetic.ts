/**
 * Fonetisk nøkkel for norsk (bokmål): ord som LYDER likt får samme nøkkel,
 * selv når stavingen er langt unna («sjørnalist» og «journalist» → samme).
 *
 * Reglene er symmetriske — de brukes på både ordbokord og feilstavinger —
 * og fanger lydmønstrene som dominerer i dysleksirelaterte stavefeil:
 * sj/kj/skj-sammenfall, stumme bokstaver (hv, hj, gj, -d, -t, -g),
 * enkel/dobbel konsonant og vokalforvekslinger (æ/e, å/o, y/i).
 */

const MULTI_RULES: Array<[RegExp, string]> = [
  // sj-/kj-lyden: alle skrivemåter → S (kj og sj holdes samlet fordi
  // forvekslingen er selve kjernefeilen — rangeringen skiller etterpå)
  [/skj|sj|kj|tj/g, "S"],
  [/sk(?=[iyøe])/g, "S"],
  [/k(?=[iy])/g, "S"],
  [/rs/g, "S"],
  [/ch/g, "S"],
  // j-lyden: gj/hj/lj/g(i,y,ei) → j. Merk at j og sj-lyden slås sammen
  // lenger ned (SINGLE_MAP): norsk uttaler mange j-lånord med sj-lyd
  // («journalist» = sjornalist, «jury» = sjyri), og sj/j-forveksling er
  // en kjernefeil ved dysleksi.
  [/gj|hj|lj/g, "j"],
  [/g(?=[iy])/g, "j"],
  [/g(?=ei)/g, "j"],
  // stumme/forenklede grupper
  [/hv/g, "v"],
  [/eg$/g, "ei"], // jeg→jei, deg→dei
  [/gn/g, "N"], // regn/tegn — nasal i praksis
  // lånte grafem
  [/qu/g, "kv"],
  [/ph/g, "f"],
  [/th/g, "t"],
];

const SINGLE_MAP: Record<string, string> = {
  c: "k",
  q: "k",
  w: "v",
  x: "s", // x→ks; k-en gjenskapes ikke, men begge sider mister den likt
  z: "s",
  æ: "e",
  å: "o",
  ø: "o", // rundede bakre vokaler samles — o/u/å/ø-forveksling er
  u: "o", // gjennomgående i dysleksidata (og i lånord: journalist/sjåfør)
  y: "i",
  // j → sj-lyden (se MULTI_RULES); rangeringen skiller kandidatene etterpå
  j: "S",
  // stemt→ustemt: dysleksirelaterte plosivforvekslinger (g/k, b/p, d/t)
  // havner i samme nøkkel — rangeringen skiller etterpå
  g: "k",
  b: "p",
  d: "t",
  "é": "e", "è": "e", "ê": "e", "á": "a", "à": "a", "ó": "o", "ò": "o", "ô": "o", "ü": "i", "ä": "e", "ö": "ø",
};

/** Stumme endelser: -d etter vokal/l/n/r, -t i trykklett -et, -g i -ig */
function dropSilentEndings(s: string): string {
  return s
    .replace(/ig$/, "i") // veldig→veldi
    .replace(/et$/, "e") // huset→huse, det→de
    .replace(/([aeiouøolnr])d$/, "$1"); // god→go, land→lan
}

export function phoneticKey(word: string): string {
  let s = word.toLowerCase();
  s = dropSilentEndings(s);
  for (const [re, to] of MULTI_RULES) s = s.replace(re, to);
  s = s.replace(/[a-zæøåéèêáàóòôüäö]/g, (ch) => SINGLE_MAP[ch] ?? ch);
  // Andre pass: stemt→ustemt-mappingen kan ha dannet nye klynger
  // («sgip»→«skip»→Sip, «besgjed»→«besjed»→beSet)
  s = s.replace(/sk(?=[iyøe])/g, "S").replace(/sj|kj|tj/g, "S").replace(/k(?=[iy])/g, "S");
  s = s.replace(/(.)\1+/g, "$1"); // dobbel → enkel (alle tegn)
  return s;
}

/* ---------------- Vektet redigeringsavstand ---------------- */

/** Forvekslingsklasser: bytte innen samme klasse koster lite */
const CONFUSION_CLASSES = [
  "oåu", // får/for, komme/kumme
  "eæ",
  "iyj",
  "kg", // stemte/ustemte plosiver
  "pb",
  "td",
  "vwf",
  "szc",
] as const;

const classOf = new Map<string, number>();
CONFUSION_CLASSES.forEach((cls, i) => {
  for (const ch of cls) classOf.set(ch, i);
});

function substCost(a: string, b: string): number {
  if (a === b) return 0;
  const ca = classOf.get(a);
  return ca !== undefined && ca === classOf.get(b) ? 0.4 : 1;
}

/**
 * Damerau-Levenshtein med dysleksivekter:
 *  - bytte innen forvekslingsklasse: 0.4
 *  - dublering/fjerning av nabobokstav (enkel↔dobbel konsonant): 0.3
 *  - ombytting av to nabobokstaver (rekkefølgefeil): 0.5
 *  - annet: 1.0
 */
export function weightedDistance(a: string, b: string, cap = 6): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > cap) return cap;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      // innsetting/sletting koster mindre hvis tegnet dobler naboen
      const delCost = i > 1 && a[i - 1] === a[i - 2] ? 0.3 : 1;
      const insCost = j > 1 && b[j - 1] === b[j - 2] ? 0.3 : 1;
      let best = Math.min(
        d[i - 1][j] + delCost,
        d[i][j - 1] + insCost,
        d[i - 1][j - 1] + substCost(a[i - 1], b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && a[i - 1] !== a[i - 2]) {
        best = Math.min(best, d[i - 2][j - 2] + 0.5);
      }
      d[i][j] = best;
    }
  }
  return d[n][m];
}
