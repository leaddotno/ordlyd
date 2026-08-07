import {
  SpeechController,
  configureLocalAssets,
  tokenizeWords,
  DEFAULT_VOICE,
} from "@skrivestotte/tts";

// Samme offline-oppsett som utvidelsen: stemme og WASM serveres lokalt
configureLocalAssets({
  voiceBaseUrl: "/voices",
  onnxWasmBaseUrl: "/ort/",
  piperWasmUrl: "/piper/piper_phonemize.wasm",
  piperDataUrl: "/piper/piper_phonemize.data",
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("input");
const reader = $<HTMLDivElement>("reader");
const speakBtn = $<HTMLButtonElement>("speak");
const pauseBtn = $<HTMLButtonElement>("pause");
const resumeBtn = $<HTMLButtonElement>("resume");
const stopBtn = $<HTMLButtonElement>("stop");
const rateInput = $<HTMLInputElement>("rate");
const rateVal = $<HTMLSpanElement>("rateVal");
const dlBox = $<HTMLDivElement>("download");
const dlProgress = $<HTMLProgressElement>("dlProgress");
const dlText = $<HTMLSpanElement>("dlText");
const log = $<HTMLUListElement>("log");

const controller = new SpeechController({ rate: 1 });

function addLog(msg: string) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString("nb-NO")} — ${msg}`;
  log.appendChild(li);
  console.log("[demo]", msg);
}

function setBusy(busy: boolean) {
  speakBtn.disabled = busy;
  pauseBtn.disabled = !busy;
  resumeBtn.disabled = !busy;
  stopBtn.disabled = !busy;
}

/** Render teksten som ett <span class="w"> per ord, med samme tokenisering som TTS-en. */
function renderText(text: string): HTMLSpanElement[] {
  reader.textContent = "";
  const words = tokenizeWords(text);
  const spans: HTMLSpanElement[] = [];
  let cursor = 0;
  for (const w of words) {
    if (w.start > cursor) {
      reader.appendChild(document.createTextNode(text.slice(cursor, w.start)));
    }
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = w.text;
    reader.appendChild(span);
    spans.push(span);
    cursor = w.end;
  }
  if (cursor < text.length) {
    reader.appendChild(document.createTextNode(text.slice(cursor)));
  }
  return spans;
}

rateInput.addEventListener("input", () => {
  const r = Number(rateInput.value);
  rateVal.textContent = `${r.toFixed(1)}×`;
  controller.setRate(r);
});

pauseBtn.addEventListener("click", () => controller.pause());
resumeBtn.addEventListener("click", () => controller.resume());
stopBtn.addEventListener("click", () => controller.stop());

speakBtn.addEventListener("click", async () => {
  const text = input.value.trim();
  if (!text) return;

  const spans = renderText(text);
  let active: HTMLSpanElement | null = null;
  const tClick = performance.now();
  let firstWordLogged = false;

  setBusy(true);
  addLog(`Start: ${tokenizeWords(text).length} ord, stemme ${DEFAULT_VOICE}`);

  await controller.speak(text, {
    onDownload: (p) => {
      dlBox.hidden = false;
      if (p.total > 0) {
        const pct = Math.round((p.loaded / p.total) * 100);
        dlProgress.value = pct;
        dlText.textContent = `${pct}% – ${p.url.split("/").pop()}`;
      }
    },
    onSentence: ({ sentenceIndex, sentence }) => {
      addLog(`Setning ${sentenceIndex + 1}: «${sentence.text.slice(0, 40)}…»`);
    },
    onWord: (i) => {
      if (!firstWordLogged) {
        firstWordLogged = true;
        addLog(`⏱ Tid til første lyd: ${Math.round(performance.now() - tClick)} ms`);
      }
      active?.classList.remove("active");
      active = spans[i] ?? null;
      active?.classList.add("active");
      active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    onEnd: ({ stopped }) => {
      dlBox.hidden = true;
      active?.classList.remove("active");
      setBusy(false);
      addLog(stopped ? "Stoppet." : "Ferdig opplest.");
    },
    onError: (err) => {
      addLog(`FEIL: ${err instanceof Error ? err.message : String(err)}`);
      console.error(err);
    },
  });
});

addLog("Offline-modus: stemme og WASM serveres lokalt (ingen internettavhengighet).");

// Skrivestøtte-testen: samme motor som utvidelsen bruker
import { Predictor, enableWritingSupport, type WritingSupport } from "@skrivestotte/writing";
void Predictor.fromUrl("/dict/nb.txt").then((predictor) => {
  // Riv ned forrige instans ved Vite hot-reload, ellers dobles lytterne
  const w = window as unknown as { __writingSupport?: WritingSupport };
  w.__writingSupport?.destroy();
  w.__writingSupport = enableWritingSupport(document, predictor, {});
  addLog(`Ordbank lastet: ${predictor.size} ord.`);
});
