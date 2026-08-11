/**
 * Content script: marker tekst → flytende «Les opp»-knapp → ordmarkering
 * synkront med opplesingen. Bruker CSS Custom Highlight API, så sidens DOM
 * endres aldri (viktig for å ikke ødelegge weben rundt oss).
 */
import { tokenizeWords } from "@skrivestotte/tts/text";
import { enableWritingSupport, type SuggestSource } from "@skrivestotte/writing";
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type Settings } from "./settings.js";
import type { TtsEvent } from "./messages.js";

/* ---------- Innstillinger ---------- */

let settings: Settings = DEFAULT_SETTINGS;
void getSettings().then((s) => {
  settings = s;
  maybeInitPrediction();
});
onSettingsChanged((s) => {
  settings = s;
  if (!s.enabled) {
    hideButton();
    void chrome.runtime.sendMessage({ type: "ss-stop" }).catch(() => {});
  }
  maybeInitPrediction();
});

/* ---------- Stil for markering (Custom Highlight API) ---------- */
const style = document.createElement("style");
style.textContent = `
  ::highlight(ss-word) { background-color: #fbbf24; color: #111; }
  ::highlight(ss-sentence) { background-color: rgba(251, 191, 36, 0.25); }
`;
document.documentElement.appendChild(style);

/* ---------- Kartlegging: markert tekst → ord-Ranges i sidens DOM ---------- */

interface Segment {
  node: Text;
  /** Offset i node der segmentet starter */
  nodeStart: number;
  /** Global startposisjon i den sammensatte teksten */
  globalStart: number;
  length: number;
}

interface ExtractedSelection {
  text: string;
  segments: Segment[];
}

/** Trekk ut tekst + segmentkart fra gjeldende selection (kan spenne flere noder). */
function extractSelection(range: Range): ExtractedSelection | null {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode ?? root : root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    },
  );

  const segments: Segment[] = [];
  let text = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    let start = 0;
    let end = t.data.length;
    if (t === range.startContainer) start = range.startOffset;
    if (t === range.endContainer) end = range.endOffset;
    if (end <= start) continue;
    // Hopp over tekst i skjulte elementer og script/style
    const parent = t.parentElement;
    if (parent) {
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    }
    segments.push({ node: t, nodeStart: start, globalStart: text.length, length: end - start });
    text += t.data.slice(start, end);
    text += " "; // nodegrense = ordgrense (blokk-elementer har ikke mellomrom i DOM)
  }
  if (!text.trim()) return null;
  return { text, segments };
}

/** Global tegnposisjon → (tekstnode, lokal offset). */
function locate(segments: Segment[], globalPos: number): { node: Text; offset: number } | null {
  for (const s of segments) {
    if (globalPos >= s.globalStart && globalPos <= s.globalStart + s.length) {
      return { node: s.node, offset: s.nodeStart + (globalPos - s.globalStart) };
    }
  }
  return null;
}

function buildWordRanges(extracted: ExtractedSelection): { ranges: Range[]; text: string } {
  const words = tokenizeWords(extracted.text);
  const ranges: Range[] = [];
  for (const w of words) {
    const from = locate(extracted.segments, w.start);
    const to = locate(extracted.segments, w.end);
    if (!from || !to) {
      ranges.push(new Range()); // plassholder så indeksene stemmer
      continue;
    }
    const r = new Range();
    r.setStart(from.node, from.offset);
    r.setEnd(to.node, to.offset);
    ranges.push(r);
  }
  return { ranges, text: extracted.text };
}

/* ---------- Flytende knapp ---------- */

const host = document.createElement("div");
host.style.cssText = "position: fixed; z-index: 2147483647; display: none;";
const shadow = host.attachShadow({ mode: "closed" });
const button = document.createElement("button");
button.textContent = "🔊 Les opp";
button.style.cssText = `
  font: 14px/1 system-ui, sans-serif; padding: 8px 14px; border-radius: 999px;
  border: none; background: #2563eb; color: white; cursor: pointer;
  box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
`;
shadow.appendChild(button);
document.documentElement.appendChild(host);

let speaking = false;
let wordRanges: Range[] = [];
let pendingRange: Range | null = null;

function setButton(state: "idle" | "speaking") {
  speaking = state === "speaking";
  button.textContent = speaking ? "⏹ Stopp" : "🔊 Les opp";
  button.style.background = speaking ? "#dc2626" : "#2563eb";
}

function hideButton() {
  if (!speaking) host.style.display = "none";
}

function clearHighlights() {
  CSS.highlights?.delete("ss-word");
  CSS.highlights?.delete("ss-sentence");
}

/* ---------- Ordforslag (lazy: lastes først når et tekstfelt får fokus) ---------- */

let predictionInited = false;

/** Ordbanken bor i offscreen-dokumentet — fanen spør via meldinger. */
const remotePredictor: SuggestSource = {
  suggest: (prefix, max = 5) =>
    chrome.runtime
      .sendMessage({ type: "ss-suggest", prefix, max })
      .then((res: unknown) => (Array.isArray(res) ? (res as string[]) : []))
      .catch(() => []),
};

function maybeInitPrediction(): void {
  if (predictionInited || !settings.enabled || !settings.prediction) return;
  predictionInited = true;
  enableWritingSupport(document, remotePredictor, {
    isEnabled: () => settings.enabled && settings.prediction,
    // Forslag leses opp ved pilnavigering og innsetting når ordekko er på
    onHighlight: (word) => {
      if (settings.echoWords) sendEcho("word", word);
    },
    onAccept: (word) => {
      if (settings.echoWords) sendEcho("word", word);
    },
  });
  // Varm opp: første fokus i noe redigerbart trigger lasting av ordbanken
  // i offscreen, så forslagene er raske når brukeren faktisk skriver
  const warmup = (e: FocusEvent): void => {
    const t = e.target;
    const editable =
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLInputElement ||
      (t instanceof HTMLElement && t.isContentEditable);
    if (!editable) return;
    document.removeEventListener("focusin", warmup);
    void remotePredictor.suggest("", 0);
  };
  document.addEventListener("focusin", warmup);
}

document.addEventListener("selectionchange", () => {
  if (speaking) return;
  if (!settings.enabled) return hideButton();
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    hideButton();
    return;
  }
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideButton();
    return;
  }
  pendingRange = range.cloneRange();
  host.style.display = "block";
  host.style.left = `${Math.min(window.innerWidth - 130, Math.max(8, rect.right - 40))}px`;
  host.style.top = `${Math.min(window.innerHeight - 48, rect.bottom + 8)}px`;
});

/**
 * Vakthund: får vi ingen hendelser tilbake innen rimelig tid etter start,
 * er noe galt i syntesekjeden — da nullstilles knappen i stedet for å henge.
 */
let watchdog: ReturnType<typeof setTimeout> | undefined;

function armWatchdog(): void {
  clearTimeout(watchdog);
  // 45 s: første opplesing etter oppstart laster talemodellen (63 MB),
  // og det kan ta 15–30 s på svake skole-PC-er. Vakthunden skal fange
  // ekte feil, ikke treg maskinvare.
  watchdog = setTimeout(() => {
    console.warn("[Skrivestøtte] ingen respons fra talesyntesen på 45 s — nullstiller.");
    clearHighlights();
    setButton("idle");
    hideButton();
  }, 45_000);
}

function disarmWatchdog(): void {
  clearTimeout(watchdog);
  watchdog = undefined;
}

button.addEventListener("click", () => {
  if (speaking) {
    void chrome.runtime.sendMessage({ type: "ss-stop" }).catch(() => {});
    // Nullstill lokalt uansett – stopp skal alltid virke øyeblikkelig
    disarmWatchdog();
    clearHighlights();
    setButton("idle");
    hideButton();
    return;
  }
  if (!pendingRange) return;
  const extracted = extractSelection(pendingRange);
  if (!extracted) return;
  const built = buildWordRanges(extracted);
  wordRanges = built.ranges;
  setButton("speaking");
  armWatchdog();
  document.getSelection()?.removeAllRanges(); // markeringen vår skal synes i stedet
  chrome.runtime.sendMessage({ type: "ss-speak", text: built.text, rate: settings.rate }).catch((err) => {
    console.error("[Skrivestøtte] kunne ikke starte opplesing:", err);
    disarmWatchdog();
    setButton("idle");
    hideButton();
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && speaking) {
    void chrome.runtime.sendMessage({ type: "ss-stop" }).catch(() => {});
  }
});

/* ---------- Skriveekko: hør det du skriver ---------- */

function isEchoTarget(t: EventTarget | null): t is HTMLElement {
  if (t instanceof HTMLTextAreaElement) return true;
  if (t instanceof HTMLInputElement) {
    return ["text", "search", "email", "url"].includes(t.type); // aldri passord
  }
  return t instanceof HTMLElement && t.isContentEditable;
}

function textBeforeCaret(t: HTMLElement): string {
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) {
    return t.value.slice(0, t.selectionStart ?? t.value.length);
  }
  const sel = document.getSelection();
  if (!sel?.anchorNode || sel.anchorNode.nodeType !== Node.TEXT_NODE) return "";
  return (sel.anchorNode.textContent ?? "").slice(0, sel.anchorOffset);
}

function lastWordIn(text: string): string | null {
  const m = text.match(/([\p{L}\p{N}][\p{L}\p{N}'’-]*)[^\p{L}\p{N}]*$/u);
  return m ? m[1] : null;
}

function lastSentenceIn(text: string): string | null {
  const trimmed = text.replace(/\s+$/u, "");
  const m = trimmed.match(/[^.!?]+[.!?]$/u);
  return (m ? m[0] : trimmed.slice(-200)).trim() || null;
}

function sendEcho(kind: "letter" | "word" | "sentence", text: string): void {
  void chrome.runtime
    .sendMessage({ type: "ss-echo", kind, text, rate: settings.rate })
    .catch(() => {});
}

document.addEventListener("input", (e) => {
  if (!(e instanceof InputEvent) || e.isComposing || !settings.enabled) return;
  const t = e.target;
  if (!isEchoTarget(t)) return;

  const isBreak = e.inputType === "insertParagraph" || e.inputType === "insertLineBreak";
  const ch = e.inputType === "insertText" && e.data?.length === 1 ? e.data : "";

  // Bokstav/tall skrevet → bokstavekko
  if (ch && /[\p{L}\p{N}]/u.test(ch)) {
    if (settings.echoLetters) sendEcho("letter", ch.toLowerCase());
    return;
  }

  // Ordgrense (mellomrom, skilletegn, linjeskift) → ord- eller setningsekko
  const isSentenceEnd = /[.!?]/.test(ch);
  const isWordBoundary = isBreak || (ch !== "" && /[\s,;:.!?]/.test(ch));
  if (!isWordBoundary) return;

  const before = textBeforeCaret(t);
  if (isSentenceEnd && settings.echoSentences) {
    const sentence = lastSentenceIn(before);
    if (sentence) sendEcho("sentence", sentence);
  } else if (settings.echoWords) {
    const word = lastWordIn(before);
    if (word) sendEcho("word", word);
  }
});

/* ---------- Hendelser fra opplesingen ---------- */

chrome.runtime.onMessage.addListener((event: TtsEvent) => {
  // Alle hendelser beviser at kjeden lever — mat vakthunden
  if (event.kind === "end" || event.kind === "error") {
    disarmWatchdog();
  } else if (speaking) {
    armWatchdog();
  }
  switch (event.kind) {
    case "word": {
      const range = wordRanges[event.globalWordIndex];
      if (range && CSS.highlights) {
        CSS.highlights.set("ss-word", new Highlight(range));
        // Rull ordet inn i synsfeltet ved behov
        const rect = range.getBoundingClientRect();
        if (rect.bottom > window.innerHeight || rect.top < 0) {
          range.startContainer.parentElement?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
        }
      }
      break;
    }
    case "download":
      button.textContent = `⬇ ${Math.round((event.loaded / Math.max(1, event.total)) * 100)} %`;
      break;
    case "error":
      console.warn("[Skrivestøtte] TTS-feil:", event.message);
    // fallthrough
    case "end":
      clearHighlights();
      setButton("idle");
      hideButton();
      break;
  }
});
