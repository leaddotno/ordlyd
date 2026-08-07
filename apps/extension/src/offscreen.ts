/**
 * Offscreen-dokument: kjører Piper-syntesen og spiller av lyd.
 * Sender ord-/setningshendelser tilbake via service workeren,
 * som videresender til riktig fane.
 */
import { SpeechController, configureLocalAssets } from "@skrivestotte/tts";
import type { OffscreenSpeak, OffscreenStop, TtsEvent } from "./messages.js";

const LOG = "[Skrivestøtte offscreen]";

// Alt bundles i utvidelsespakken – null internettavhengighet ved bruk.
configureLocalAssets({
  voiceBaseUrl: chrome.runtime.getURL("voices"),
  onnxWasmBaseUrl: chrome.runtime.getURL("ort/"),
  piperWasmUrl: chrome.runtime.getURL("piper/piper_phonemize.wasm"),
  piperDataUrl: chrome.runtime.getURL("piper/piper_phonemize.data"),
});

const controller = new SpeechController();

function emit(tabId: number, event: TtsEvent): void {
  void chrome.runtime.sendMessage({ type: "ss-event", tabId, event }).catch((err) => {
    console.warn(LOG, "kunne ikke sende hendelse:", err);
  });
}

// VIKTIG: meldingslytteren registreres FØR alt som kan feile — dør noe
// annet under oppstart, skal opplesing likevel fungere.
chrome.runtime.onMessage.addListener((msg: OffscreenSpeak | OffscreenStop, _sender, sendResponse) => {
  if (!("target" in msg) || msg.target !== "offscreen") return;

  if (msg.type === "ss-offscreen-stop") {
    controller.stop();
    sendResponse();
    return;
  }

  if (msg.type === "ss-offscreen-speak") {
    const { text, tabId } = msg;
    console.log(LOG, `starter opplesing (${text.length} tegn)`);
    controller.stop();
    void controller
      .speak(text, {
        onDownload: (p) => emit(tabId, { kind: "download", loaded: p.loaded, total: p.total }),
        onSentence: ({ sentence }) =>
          emit(tabId, { kind: "sentence", sentenceIndex: 0, start: sentence.start, end: sentence.end }),
        onWord: (globalWordIndex) => emit(tabId, { kind: "word", globalWordIndex }),
        onEnd: ({ stopped }) => emit(tabId, { kind: "end", stopped }),
        onError: (err) => {
          console.error(LOG, "syntese feilet:", err);
          emit(tabId, { kind: "error", message: err instanceof Error ? err.message : String(err) });
        },
      })
      .catch((err) => {
        console.error(LOG, "uventet feil:", err);
        emit(tabId, { kind: "error", message: String(err) });
      });
    sendResponse();
  }
});

// Hastighet fra innstillingene – hentes ved oppstart og følges live.
// chrome.storage kan mangle (f.eks. gammel manifest uten storage-tillatelse) —
// da kjører vi videre med standardhastighet i stedet for å dø.
try {
  chrome.storage?.sync
    ?.get({ rate: 1 })
    .then(({ rate }) => controller.setRate(rate as number))
    .catch((err: unknown) => console.warn(LOG, "kunne ikke lese innstillinger:", err));
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "sync" && changes.rate) controller.setRate(changes.rate.newValue as number);
  });
} catch (err) {
  console.warn(LOG, "innstillinger utilgjengelige:", err);
}

console.log(LOG, "klar. Stemme-base:", chrome.runtime.getURL("voices"));
