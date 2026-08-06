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
 * Enkel setningsdeling med bevarte offsets.
 * Deler etter . ! ? : etterfulgt av mellomrom/linjeskift. God nok for opplesing;
 * forkortelser som deles feil gir bare en ekstra kunstpause.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const re = /[^.!?:\n]+[.!?:]*\s*/gu;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = m.index! + raw.indexOf(trimmed);
    spans.push({ text: trimmed, start, end: start + trimmed.length });
  }
  if (spans.length === 0 && text.trim()) {
    const t = text.trim();
    const start = text.indexOf(t);
    spans.push({ text: t, start, end: start + t.length });
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
