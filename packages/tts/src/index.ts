/**
 * TTS-motor: Piper (VITS) i nettleseren via WebAssembly.
 * Syntetiserer setning for setning (lav opplevd latens, neste setning
 * prefetches mens den forrige spilles av) og sender ordhendelser
 * basert på estimerte tidspunkter.
 */
import * as piper from "@mintplex-labs/piper-tts-web";
import {
  splitSentences,
  tokenizeWords,
  estimateWordTimings,
  type SentenceSpan,
  type WordToken,
} from "./text.js";

export * from "./text.js";

export const DEFAULT_VOICE = "no_NO-talesyntese-medium" as const;

export interface DownloadProgress {
  url: string;
  loaded: number;
  total: number;
}

/**
 * Lokale ressurser (offline-drift): når disse er satt, hentes stemme og
 * WASM fra egne URL-er (f.eks. chrome.runtime.getURL i utvidelsen) i stedet
 * for HuggingFace/CDN. Da trengs ingen internettilgang i det hele tatt.
 */
export interface LocalAssets {
  /** Base-URL med samme mappestruktur som piper-voices (no/no_NO/talesyntese/…) */
  voiceBaseUrl: string;
  /** Mappe med onnxruntime-web sine .wasm-filer (må slutte med /) */
  onnxWasmBaseUrl: string;
  piperWasmUrl: string;
  piperDataUrl: string;
  /**
   * Tillat flertrådet syntese (raskere, men krever crossOriginIsolated).
   *
   * MÅ være av i nettleserutvidelser: ORT starter trådene fra blob:-URL-er,
   * og MV3-utvidelsers CSP (`script-src 'self'`) blokkerer blob:-skript.
   * Resultatet er at modellen aldri lastes og hele offscreen-dokumentet dør.
   * Vanlige nettsider (demoen) har ikke denne restriksjonen.
   */
  allowThreads?: boolean;
}

let localAssets: LocalAssets | undefined;

export function configureLocalAssets(assets: LocalAssets): void {
  localAssets = assets;
  const g = globalThis as Record<string, unknown>;
  g.__PIPER_VOICE_BASE__ = assets.voiceBaseUrl.replace(/\/$/, "");
  g.__ORT_ALLOW_THREADS__ = assets.allowThreads === true;
}

export interface SpeakCallbacks {
  /** Ny setning startet. words har *globale* tegnoffsets i hele teksten. */
  onSentence?: (info: {
    sentenceIndex: number;
    sentence: SentenceSpan;
    words: WordToken[];
    firstGlobalWordIndex: number;
  }) => void;
  /** Nytt ord. globalWordIndex teller over hele teksten. */
  onWord?: (globalWordIndex: number) => void;
  /** Hele teksten ferdig opplest (eller stoppet — da med stopped=true). */
  onEnd?: (info: { stopped: boolean }) => void;
  onError?: (err: unknown) => void;
  /** Nedlastingsprogresjon for stemmefiler ved første bruk. */
  onDownload?: (p: DownloadProgress) => void;
}

export interface SpeechOptions {
  voiceId?: string;
  /** Avspillingshastighet, 0.5–2.0 */
  rate?: number;
}

/** Er stemmen allerede lastet ned og lagret lokalt? */
export async function voiceIsStored(voiceId: string = DEFAULT_VOICE): Promise<boolean> {
  const stored = await piper.stored();
  return stored.includes(voiceId as never);
}

function readVarint(bytes: Uint8Array, pos: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value, next: pos };
    shift += 7;
    if (shift > 49) return null;
  }
  return null;
}

/**
 * Er ONNX-filen komplett? Protobuf-headeren deklarerer graf-feltets lengde,
 * så en avbrutt nedlasting avsløres ved at filen er kortere enn deklarert.
 * (En halvskrevet fil gir ellers «No graph was found in the protobuf» ved bruk.)
 */
async function modelLooksComplete(model: File): Promise<boolean> {
  const head = new Uint8Array(await model.slice(0, 128).arrayBuffer());
  let pos = 0;
  while (pos < head.length - 1) {
    const tag = readVarint(head, pos);
    if (!tag) return false;
    pos = tag.next;
    const field = tag.value >> 3;
    const wire = tag.value & 7;
    if (wire === 0) {
      const v = readVarint(head, pos);
      if (!v) return false;
      pos = v.next;
    } else if (wire === 2) {
      const len = readVarint(head, pos);
      if (!len) return false;
      pos = len.next;
      if (field === 7) {
        // felt 7 = graph — hele filen må romme den deklarerte lengden
        return pos + len.value <= model.size;
      }
      pos += len.value; // hopp over små strengfelt (produsentnavn o.l.)
    } else {
      return false;
    }
  }
  return false; // fant ikke graf-feltet i headeren
}

/** Sjekk at de lagrede stemmefilene er komplette og gyldige. */
async function voiceFilesLookValid(voiceId: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("piper");
    const model = await (await dir.getFileHandle(`${voiceId}.onnx`)).getFile();
    const config = await (await dir.getFileHandle(`${voiceId}.onnx.json`)).getFile();
    if (config.size < 100) return false;
    return modelLooksComplete(model);
  } catch {
    return false;
  }
}

/**
 * Sørg for at stemmen er lastet ned og gyldig før første syntese.
 * Reparerer automatisk ødelagte filer fra tidligere avbrutte nedlastinger.
 */
export async function ensureVoice(
  voiceId: string = DEFAULT_VOICE,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  // Lokalt bundlet stemme: ingen nedlasting eller OPFS-validering nødvendig
  if (localAssets) return;
  if (await voiceFilesLookValid(voiceId)) return;
  try {
    await piper.remove(voiceId as never);
  } catch {
    // fantes ikke – helt fint
  }
  await piper.download(voiceId as never, (p: DownloadProgress) => onProgress?.(p));
  if (!(await voiceFilesLookValid(voiceId))) {
    throw new Error(`Stemmen ${voiceId} ble lastet ned, men filene er ugyldige.`);
  }
}

/** Last ned stemme eksplisitt (predict laster også ved behov). */
export async function downloadVoice(
  voiceId: string = DEFAULT_VOICE,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  await piper.download(voiceId as never, (p: DownloadProgress) => onProgress?.(p));
}

let session: InstanceType<typeof piper.TtsSession> | null = null;

/** Engangs-syntese til lydblob (brukes bl.a. av skriveekko). */
export function synthesizeText(text: string, voiceId: string = DEFAULT_VOICE): Promise<Blob> {
  return synthesize(text, voiceId);
}

async function synthesize(text: string, voiceId: string): Promise<Blob> {
  if (!session || session.voiceId !== voiceId) {
    session = new piper.TtsSession({
      voiceId: voiceId as never,
      wasmPaths: localAssets
        ? {
            onnxWasm: localAssets.onnxWasmBaseUrl,
            piperWasm: localAssets.piperWasmUrl,
            piperData: localAssets.piperDataUrl,
          }
        : undefined,
    });
  }
  return session.predict(text);
}

function blobDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(a.duration);
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Kunne ikke lese lydmetadata"));
    };
    a.src = url;
  });
}

interface PreparedSentence {
  span: SentenceSpan;
  words: WordToken[]; // globale offsets
  firstGlobalWordIndex: number;
  blob: Promise<Blob>;
}

export class SpeechController {
  private voiceId: string;
  private rate: number;
  private audio: HTMLAudioElement | null = null;
  private stopped = false;
  private speaking = false;

  constructor(opts: SpeechOptions = {}) {
    this.voiceId = opts.voiceId ?? DEFAULT_VOICE;
    this.rate = opts.rate ?? 1;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  setRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.5, rate));
    if (this.audio) this.audio.playbackRate = this.rate;
  }

  pause(): void {
    this.audio?.pause();
  }

  resume(): void {
    void this.audio?.play();
  }

  stop(): void {
    this.stopped = true;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }

  /** Les opp hele teksten. Returnerer når alt er ferdig eller stoppet. */
  async speak(text: string, cb: SpeakCallbacks = {}): Promise<void> {
    if (this.speaking) this.stop();
    this.stopped = false;
    this.speaking = true;

    try {
      await ensureVoice(this.voiceId, cb.onDownload);

      const sentences = splitSentences(text);
      let globalWordCount = 0;
      const prepared: PreparedSentence[] = sentences.map((span) => {
        const words = tokenizeWords(span.text).map((w) => ({
          text: w.text,
          start: w.start + span.start,
          end: w.end + span.start,
        }));
        const p: PreparedSentence = {
          span,
          words,
          firstGlobalWordIndex: globalWordCount,
          // Lazy – settes rett før bruk, prefetch styres i løkka under
          blob: undefined as unknown as Promise<Blob>,
        };
        globalWordCount += words.length;
        return p;
      });

      // Prefetch: start syntese av setning n+1 mens n spilles av.
      const startSynth = (i: number) => {
        if (i < prepared.length && !prepared[i].blob) {
          prepared[i].blob = synthesize(prepared[i].span.text, this.voiceId);
        }
      };
      startSynth(0);

      for (let i = 0; i < prepared.length; i++) {
        if (this.stopped) break;
        const s = prepared[i];
        const blob = await s.blob;
        if (this.stopped) break;
        startSynth(i + 1);

        const duration = await blobDuration(blob);
        const localWords = tokenizeWords(s.span.text);
        const timings = estimateWordTimings(s.span.text, localWords, duration);

        cb.onSentence?.({
          sentenceIndex: i,
          sentence: s.span,
          words: s.words,
          firstGlobalWordIndex: s.firstGlobalWordIndex,
        });

        await this.playWithTimings(blob, timings, s.firstGlobalWordIndex, cb);
      }

      cb.onEnd?.({ stopped: this.stopped });
    } catch (err) {
      cb.onError?.(err);
      cb.onEnd?.({ stopped: true });
    } finally {
      this.speaking = false;
    }
  }

  private playWithTimings(
    blob: Blob,
    timings: { tStart: number }[],
    firstGlobalWordIndex: number,
    cb: SpeakCallbacks,
  ): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = this.rate;
      this.audio = audio;

      let nextWord = 0;
      let raf = 0;
      // currentTime er i medietid, så estimatene holder også ved endret hastighet
      const advance = () => {
        while (nextWord < timings.length && audio.currentTime >= timings[nextWord].tStart) {
          cb.onWord?.(firstGlobalWordIndex + nextWord);
          nextWord++;
        }
      };
      const tick = () => {
        if (this.stopped) return finish();
        advance();
        raf = requestAnimationFrame(tick);
      };
      // rAF throttles/fryser i bakgrunnsfaner – timeupdate holder markeringen i gang da
      audio.ontimeupdate = () => {
        if (!this.stopped) advance();
      };

      const finish = () => {
        cancelAnimationFrame(raf);
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.audio = null;
        resolve();
      };

      audio.onended = finish;
      audio.onerror = finish;
      audio.onplay = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      };
      void audio.play().catch(() => finish());
    });
  }
}
