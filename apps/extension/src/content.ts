/**
 * Content script: marker tekst → flytende «Les opp»-knapp → ordmarkering
 * synkront med opplesingen. Bruker CSS Custom Highlight API, så sidens DOM
 * endres aldri (viktig for å ikke ødelegge weben rundt oss).
 */
import { tokenizeWords } from "@skrivestotte/tts/text";
import { Predictor, enableWritingSupport } from "@skrivestotte/writing";
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

function maybeInitPrediction(): void {
  if (predictionInited || !settings.enabled || !settings.prediction) return;
  predictionInited = true;
  // Ordbanken (~1 MB) lastes først når brukeren fokuserer noe redigerbart
  const lazyLoad = (e: FocusEvent): void => {
    const t = e.target;
    const editable =
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLInputElement ||
      (t instanceof HTMLElement && t.isContentEditable);
    if (!editable) return;
    document.removeEventListener("focusin", lazyLoad);
    Predictor.fromUrl(chrome.runtime.getURL("dict/nb.txt"))
      .then((predictor) => {
        console.log("[Skrivestøtte] ordbank lastet:", predictor.size, "ord");
        enableWritingSupport(document, predictor, {
          isEnabled: () => settings.enabled && settings.prediction,
        });
      })
      .catch((err) => {
        console.error("[Skrivestøtte] kunne ikke laste ordbank:", err);
      });
  };
  document.addEventListener("focusin", lazyLoad);
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
  watchdog = setTimeout(() => {
    console.warn("[Skrivestøtte] ingen respons fra talesyntesen på 20 s — nullstiller.");
    clearHighlights();
    setButton("idle");
    hideButton();
  }, 20_000);
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
