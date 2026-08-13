/**
 * Skriveekko-spiller (kjører i offscreen-dokumentet).
 *
 * Bokstavekko krever øyeblikkelig respons (< 100 ms), men Piper bruker
 * ~300 ms per syntese. Løsning: bokstavklippene genereres én gang og
 * caches permanent i OPFS + minne — avspilling etterpå er umiddelbar.
 * Ord-/setningsekko syntetiseres direkte (der er ~300 ms helt greit),
 * med LRU-cache for ofte brukte ord.
 */
import { synthesizeText } from "@ordlyd/tts";

/** Norske bokstavnavn og tall slik Piper skal uttale dem */
const LETTER_NAMES: Record<string, string> = {
  a: "a", b: "be", c: "se", d: "de", e: "e", f: "eff", g: "ge", h: "hå",
  i: "i", j: "jodd", k: "kå", l: "ell", m: "emm", n: "enn", o: "o",
  p: "pe", q: "ku", r: "err", s: "ess", t: "te", u: "u", v: "ve",
  w: "dobbelt-ve", x: "eks", y: "y", z: "sett",
  æ: "æ", ø: "ø", å: "å",
  "0": "null", "1": "én", "2": "to", "3": "tre", "4": "fire",
  "5": "fem", "6": "seks", "7": "sju", "8": "åtte", "9": "ni",
};

const OPFS_DIR = "echo-clips";
const WORD_CACHE_MAX = 300;

export class EchoPlayer {
  private letterClips = new Map<string, Blob>();
  private wordCache = new Map<string, Blob>(); // Map bevarer innsettingsrekkefølge → LRU
  private audio: HTMLAudioElement | null = null;
  private synthQueue: Promise<unknown> = Promise.resolve();
  private prewarmed = false;

  constructor(private isBusy: () => boolean, private log: (...args: unknown[]) => void) {}

  /** Spill ekko. Nytt ekko avbryter alltid det forrige. */
  async echo(kind: "letter" | "word" | "sentence", text: string, rate = 1): Promise<void> {
    if (this.isBusy()) return; // aldri oppå en pågående opplesing
    try {
      const blob =
        kind === "letter" ? await this.letterClip(text) : await this.wordClip(text);
      if (!blob || this.isBusy()) return;
      this.stop();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      // Bokstaver spilles alltid i normal hastighet (de er korte nok);
      // ord og setninger følger brukerens hastighet
      audio.playbackRate = kind === "letter" ? 1 : Math.min(2, Math.max(0.5, rate));
      this.audio = audio;
      audio.onended = audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.audio = null;
      };
      await audio.play().catch(() => {});
    } catch (err) {
      this.log("ekko feilet:", err);
    }
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }

  /** Generer alle bokstav-/tallklipp i bakgrunnen (én gang per maskin). */
  async prewarm(): Promise<void> {
    if (this.prewarmed) return;
    this.prewarmed = true;
    let generated = 0;
    for (const ch of Object.keys(LETTER_NAMES)) {
      try {
        const had = this.letterClips.has(ch) || (await this.readOpfs(ch)) !== null;
        if (!had) {
          await this.letterClip(ch);
          generated++;
        }
      } catch {
        // enkeltklipp kan feile uten at resten skal stoppe
      }
      await new Promise((r) => setTimeout(r, 50)); // ikke sult andre oppgaver
    }
    this.log(`bokstavklipp klare (${generated} nygenerert)`);
  }

  private async letterClip(ch: string): Promise<Blob | null> {
    const key = ch.toLowerCase();
    const name = LETTER_NAMES[key];
    if (!name) return null;
    const cached = this.letterClips.get(key);
    if (cached) return cached;
    const fromDisk = await this.readOpfs(key);
    if (fromDisk) {
      this.letterClips.set(key, fromDisk);
      return fromDisk;
    }
    const blob = await this.synthesize(name);
    this.letterClips.set(key, blob);
    void this.writeOpfs(key, blob);
    return blob;
  }

  private async wordClip(text: string): Promise<Blob> {
    const key = text.toLowerCase();
    const cached = this.wordCache.get(key);
    if (cached) {
      // LRU: flytt bakerst
      this.wordCache.delete(key);
      this.wordCache.set(key, cached);
      return cached;
    }
    const blob = await this.synthesize(text);
    this.wordCache.set(key, blob);
    if (this.wordCache.size > WORD_CACHE_MAX) {
      const oldest = this.wordCache.keys().next().value as string;
      this.wordCache.delete(oldest);
    }
    return blob;
  }

  /** Serialiser synteser så ekko aldri kjører parallelt med seg selv. */
  private synthesize(text: string): Promise<Blob> {
    const run = this.synthQueue.then(() => synthesizeText(text));
    this.synthQueue = run.catch(() => {});
    return run;
  }

  /* ---------- OPFS-cache (overlever omstart) ---------- */

  private async readOpfs(key: string): Promise<Blob | null> {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_DIR);
      const file = await (await dir.getFileHandle(`${key}.wav`)).getFile();
      return file.size > 44 ? file : null; // tom/halvskrevet wav ignoreres
    } catch {
      return null;
    }
  }

  private async writeOpfs(key: string, blob: Blob): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
      const handle = await dir.getFileHandle(`${key}.wav`, { create: true });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
    } catch {
      // cache på disk er kjekt, ikke kritisk
    }
  }
}
