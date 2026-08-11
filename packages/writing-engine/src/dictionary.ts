/**
 * Innebygd ordbok: oppslag i shardet pakke bygget fra UiB/Språkrådets åpne
 * dumper av Bokmålsordboka og Nynorskordboka (scripts/build-dictionary.mjs).
 *
 * Kun sharden ordet bor i lastes (typisk ~150 kB), med liten LRU-cache —
 * minnebruken holder seg lav uansett hvor stor ordboka er.
 */

export interface DictDef {
  /** Definisjonstekst */
  t: string;
  /** Eksempler */
  e?: string[];
  /** Underdefinisjoner/faste uttrykk */
  u?: DictDef[];
}

export interface DictArticle {
  /** Oppslagsord */
  w: string[];
  /** Ordklasse (lesbar, f.eks. «substantiv, hankjønn») */
  k: string;
  /** Bøyningsformer */
  b?: string[];
  /** Definisjoner */
  d: DictDef[];
}

/** MÅ være identisk med shardOf i scripts/build-dictionary.mjs */
export function dictShardOf(word: string): string {
  let h = 5381;
  for (let i = 0; i < word.length; i++) h = ((h * 33) ^ word.charCodeAt(i)) >>> 0;
  return (h & 0xff).toString(16).padStart(2, "0");
}

export class Dictionary {
  private cache = new Map<string, Promise<Record<string, unknown>>>();

  constructor(
    private baseUrl: string,
    private maxCachedShards = 24,
  ) {}

  private shard(path: string): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/${path}`;
    const hit = this.cache.get(url);
    if (hit) {
      // LRU: flytt bakerst
      this.cache.delete(url);
      this.cache.set(url, hit);
      return hit;
    }
    const p = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`ordbok-shard: HTTP ${res.status}`);
      return res.json() as Promise<Record<string, unknown>>;
    });
    p.catch(() => this.cache.delete(url)); // ikke cache feil
    this.cache.set(url, p);
    if (this.cache.size > this.maxCachedShards) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    return p;
  }

  /** Slå opp et ord (også bøyde former). Tomt array = ikke funnet. */
  async lookup(word: string): Promise<DictArticle[]> {
    const w = word.toLowerCase().trim();
    if (!w || w.length > 60) return [];
    const index = (await this.shard(`index/${dictShardOf(w)}.json`)) as Record<string, number[]>;
    const ids = index[w];
    if (!ids?.length) return [];
    const articles = await Promise.all(
      ids.map(async (id) => {
        const artShard = (await this.shard(
          `art/${(id % 256).toString(16).padStart(2, "0")}.json`,
        )) as Record<string, DictArticle>;
        return artShard[String(id)];
      }),
    );
    return articles.filter(Boolean);
  }
}
