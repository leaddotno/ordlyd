/**
 * Rene tekstverktøy — ingen tunge avhengigheter.
 * Importeres både av TTS-motoren (offscreen) og content scriptet i utvidelsen,
 * slik at ord-indeksene alltid stemmer overens på begge sider.
 */

export interface WordToken {
  /** Ordet slik det står i teksten */
  text: string;
  /** Startoffset (tegn) i kildeteksten */
  start: number;
  /** Sluttoffset (eksklusiv) i kildeteksten */
  end: number;
}

export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

/** Ord = bokstav-/tallsekvenser, evt. med bindestrek/apostrof inni («barne-tv», «ka'kje»). */
const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/**
 * Forkortelser hvis punktum IKKE avslutter en setning («kl. 14», «bl.a. dette»).
 * Holdes synkron med normaliseringens liste, pluss noen som ikke ekspanderes.
 */
const NO_SPLIT_TAILS = [
  "bl.a.", "f.eks.", "dvs.", "osv.", "ca.", "mht.", "pga.", "ifm.", "iht.",
  "ift.", "iflg.", "jf.", "m.m.", "m.a.o.", "o.l.", "nr.", "tlf.", "evt.",
  "ang.", "vedr.", "inkl.", "ekskl.", "mill.", "mrd.", "stk.", "etg.",
  "f.o.m.", "t.o.m.", "kl.", "kap.", "pkt.", "st.", "s.", "co.", "mv.",
];

function endsWithAbbreviation(text: string, dotIndex: number): boolean {
  const tail = text.slice(Math.max(0, dotIndex - 9), dotIndex + 1).toLowerCase();
  return NO_SPLIT_TAILS.some(
    (a) =>
      tail.endsWith(a) &&
      // tegnet foran forkortelsen må være ordgrense («bl.a.» skal ikke
      // matche slutten av et lengre ord som tilfeldigvis ender likt)
      !/[\p{L}\p{N}]/u.test(tail[tail.length - a.length - 1] ?? " "),
  );
}

/**
 * Setningsdeling med bevarte offsets.
 * Deler ved . ! ? : og linjeskift, men IKKE når punktumet
 *  - står midt i tall/datoer/klokkeslett («17.05.2026», «2.500») eller
 *  - tilhører en kjent forkortelse («kl. 14», «bl.a. dette»).
 * Uten dette hakkes teksten opp før normaliseringen rekker å ekspandere den.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let start = 0;

  const flush = (end: number): void => {
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed) {
      const s = start + raw.indexOf(trimmed);
      spans.push({ text: trimmed, start: s, end: s + trimmed.length });
    }
    start = end;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      flush(i + 1);
      continue;
    }
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== ":") continue;

    // Sluk sammenhengende tegnsetting («?!», «...»)
    let j = i;
    while (j + 1 < text.length && /[.!?:]/.test(text[j + 1])) j++;

    const next = text[j + 1];
    const spaceOrEndAfter = next === undefined || /\s/.test(next);
    if (!spaceOrEndAfter) {
      i = j; // «17.05.2026», «2.500», «3.14» — punktum midt i tall/ord
      continue;
    }
    if (ch === "." && i === j && endsWithAbbreviation(text, i)) {
      i = j; // «kl. 14», «bl.a. dette»
      continue;
    }
    flush(j + 1);
    i = j;
  }
  flush(text.length);

  if (spans.length === 0 && text.trim()) {
    const t = text.trim();
    const s = text.indexOf(t);
    spans.push({ text: t, start: s, end: s + t.length });
  }
  return spans;
}

export interface WordTiming {
  /** Indeks i tokenlisten for setningen */
  wordIndex: number;
  /** Starttid i sekunder, relativt til setningens lydklipp */
  tStart: number;
  /** Sluttid i sekunder */
  tEnd: number;
}

/**
 * Estimerer ordtidspunkter proporsjonalt med tegnvekt.
 * Piper (VITS) eksponerer ikke fonemvarigheter i standard ONNX-eksport,
 * så vi fordeler setningens målte varighet på ordene:
 *  - vekt ≈ antall tegn + 1 (ordgrense/pust)
 *  - etterfølgende komma/punktum gir ekstra pausevekt
 * Presisjonen er typisk god nok for lesestøtte; byttes senere ut med ekte
 * varigheter fra en modifisert modelleksport.
 */
export function estimateWordTimings(
  sentence: string,
  words: WordToken[],
  durationSec: number,
): WordTiming[] {
  if (words.length === 0 || durationSec <= 0) return [];
  const weights = words.map((w, i) => {
    let weight = w.text.length + 1;
    const next = sentence.slice(w.end, words[i + 1]?.start ?? sentence.length);
    if (/[,;]/.test(next)) weight += 3;
    if (/[.!?:]/.test(next)) weight += 4;
    return weight;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const timings: WordTiming[] = [];
  let t = 0;
  for (let i = 0; i < words.length; i++) {
    const dur = (weights[i] / total) * durationSec;
    timings.push({ wordIndex: i, tStart: t, tEnd: t + dur });
    t += dur;
  }
  return timings;
}
