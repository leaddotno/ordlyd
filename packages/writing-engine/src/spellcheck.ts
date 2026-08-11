/**
 * Dysleksitilpasset stavekontroll: finner riktig ord selv når staveforsøket
 * er langt unna målordet («sjørnalist» → «journalist»).
 *
 * Kandidater hentes via fonetisk indeks (samme lydnøkkel) pluss nøkler i
 * redigeringsavstand 1, og rangeres med vektet redigeringsavstand + frekvens.
 */
import { phoneticKey, weightedDistance } from "./phonetic.js";

// Tegn som kan forekomme i fonetiske nøkler (etter alle sammenslåinger)
const KEY_ALPHABET = "aefhijklmnoprstvSN";
const MAX_CANDIDATES = 500;

export interface SpellSuggestion {
  word: string;
  score: number;
}

export class SpellChecker {
  private words: string[];
  private known = new Set<string>();
  private byKey = new Map<string, number[]>();

  /** `words` må være frekvenssortert (mest brukte først) — indeks = rang. */
  constructor(words: string[]) {
    this.words = words;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      this.known.add(w);
      const key = phoneticKey(w);
      const bucket = this.byKey.get(key);
      if (bucket) bucket.push(i);
      else this.byKey.set(key, [i]);
    }
  }

  isKnown(word: string): boolean {
    return this.known.has(word.toLowerCase());
  }

  /** Forslag for et ukjent ord. Tomt array hvis ordet er kjent. */
  suggest(word: string, max = 3): string[] {
    const w = word.toLowerCase();
    if (this.known.has(w) || w.length < 2) return [];

    const key = phoneticKey(w);
    const candidateIdx = new Set<number>();
    const addBucket = (k: string) => {
      const bucket = this.byKey.get(k);
      if (!bucket) return;
      for (const idx of bucket) {
        candidateIdx.add(idx);
        if (candidateIdx.size >= MAX_CANDIDATES) return;
      }
    };

    // 1) Samme lydnøkkel (hovedtreffet for fonetiske feilstavinger)
    addBucket(key);

    // 1b) Rekkefølge- og tilleggsfeil i råordet kan endre hvilke lydklynger
    //     som dannes («sikp» gir ikke S-en i «skip»). Nøklene til råordets
    //     nabobyttinger og enkeltslettinger fanger dette.
    for (let i = 0; i < w.length - 1; i++) {
      if (w[i] !== w[i + 1]) {
        addBucket(phoneticKey(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)));
      }
    }
    for (let i = 0; i < w.length; i++) {
      addBucket(phoneticKey(w.slice(0, i) + w.slice(i + 1)));
    }

    // 2) Nøkler i redigeringsavstand 1 (fanger utelatelser/tillegg/ombytting
    //    som overlever inn i nøkkelen)
    for (let i = 0; i < key.length && candidateIdx.size < MAX_CANDIDATES; i++) {
      addBucket(key.slice(0, i) + key.slice(i + 1)); // sletting
      if (i < key.length - 1 && key[i] !== key[i + 1]) {
        addBucket(key.slice(0, i) + key[i + 1] + key[i] + key.slice(i + 2)); // ombytting
      }
      for (const ch of KEY_ALPHABET) {
        if (ch !== key[i]) addBucket(key.slice(0, i) + ch + key.slice(i + 1)); // bytte
      }
    }
    for (let i = 0; i <= key.length && candidateIdx.size < MAX_CANDIDATES; i++) {
      for (const ch of KEY_ALPHABET) {
        addBucket(key.slice(0, i) + ch + key.slice(i)); // innsetting
      }
    }

    // 3) Ranger: lydlikhet via stavelikhet (vektet avstand) + frekvensbonus
    const scored: SpellSuggestion[] = [];
    for (const idx of candidateIdx) {
      const cand = this.words[idx];
      const dist = weightedDistance(w, cand);
      if (dist > 4) continue;
      // log-dempet frekvensstraff: vanlige ord vinner ved lik avstand,
      // uten at sjeldne-men-riktige ord skvises ut
      const score = dist + Math.log10(idx + 10) * 0.18;
      scored.push({ word: cand, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, max).map((s) => s.word);
  }
}
