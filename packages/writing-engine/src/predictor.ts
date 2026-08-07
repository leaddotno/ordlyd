/**
 * Ordprediksjon: frekvensrangert prefiks-fullføring over en stor ordbank.
 * Ordbanken er sortert med mest brukte ord først, så et lineært søk gir
 * automatisk de beste forslagene først (~2–5 ms for 120 000 ord — raskt nok
 * per tastetrykk; byttes til trie senere om nødvendig).
 */

export interface PredictorOptions {
  /** Minste antall tegn før forslag vises */
  minPrefix?: number;
  /** Maks antall forslag */
  maxSuggestions?: number;
}

export class Predictor {
  private words: string[];

  private constructor(words: string[]) {
    this.words = words;
  }

  /** Last ordbank fra URL (én linje per ord, frekvenssortert). */
  static async fromUrl(url: string): Promise<Predictor> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Kunne ikke laste ordbank: HTTP ${res.status}`);
    const text = await res.text();
    return new Predictor(text.split("\n").filter(Boolean));
  }

  static fromWords(words: string[]): Predictor {
    return new Predictor(words);
  }

  get size(): number {
    return this.words.length;
  }

  /**
   * Forslag til fullføring av `prefix`. Store forbokstaver bevares
   * («Skri» → «Skriver»). Ordet selv foreslås ikke.
   */
  suggest(prefix: string, max = 5): string[] {
    const p = prefix.toLowerCase();
    if (!p) return [];
    const capitalize = prefix[0] !== p[0];
    const out: string[] = [];
    for (const w of this.words) {
      if (w.length > p.length && w.startsWith(p)) {
        out.push(capitalize ? w[0].toUpperCase() + w.slice(1) : w);
        if (out.length >= max) break;
      }
    }
    return out;
  }
}
