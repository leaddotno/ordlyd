/**
 * Offscreen-dokument: kjører Piper-syntesen og spiller av lyd.
 * Sender ord-/setningshendelser tilbake via service workeren,
 * som videresender til riktig fane.
 */
import { SpeechController } from "@skrivestotte/tts";
import type { OffscreenSpeak, OffscreenStop, TtsEvent } from "./messages.js";

const controller = new SpeechController();

function emit(tabId: number, event: TtsEvent): void {
  void chrome.runtime.sendMessage({ type: "ss-event", tabId, event }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg: OffscreenSpeak | OffscreenStop) => {
  if (!("target" in msg) || msg.target !== "offscreen") return;

  if (msg.type === "ss-offscreen-stop") {
    controller.stop();
    return;
  }

  if (msg.type === "ss-offscreen-speak") {
    const { text, tabId } = msg;
    controller.stop();
    void controller.speak(text, {
      onDownload: (p) => emit(tabId, { kind: "download", loaded: p.loaded, total: p.total }),
      onSentence: ({ sentence }) =>
        emit(tabId, { kind: "sentence", sentenceIndex: 0, start: sentence.start, end: sentence.end }),
      onWord: (globalWordIndex) => emit(tabId, { kind: "word", globalWordIndex }),
      onEnd: ({ stopped }) => emit(tabId, { kind: "end", stopped }),
      onError: (err) =>
        emit(tabId, { kind: "error", message: err instanceof Error ? err.message : String(err) }),
    });
  }
});
