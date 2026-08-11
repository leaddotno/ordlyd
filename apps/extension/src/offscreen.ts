/**
 * Offscreen-dokument: kjører Piper-syntesen og spiller av lyd.
 * Sender ord-/setningshendelser tilbake via service workeren,
 * som videresender til riktig fane.
 */
import { SpeechController, configureLocalAssets } from "@skrivestotte/tts";
import { Predictor } from "@skrivestotte/writing";
import { EchoPlayer } from "./echo-player.js";
import type {
  OffscreenEcho,
  OffscreenSpeak,
  OffscreenStop,
  OffscreenSuggest,
  TtsEvent,
} from "./messages.js";

const LOG = "[Skrivestøtte offscreen]";

// Alt bundles i utvidelsespakken – null internettavhengighet ved bruk.
configureLocalAssets({
  voiceBaseUrl: chrome.runtime.getURL("voices"),
  onnxWasmBaseUrl: chrome.runtime.getURL("ort/"),
  piperWasmUrl: chrome.runtime.getURL("piper/piper_phonemize.wasm"),
  piperDataUrl: chrome.runtime.getURL("piper/piper_phonemize.data"),
});

const controller = new SpeechController();
const echoPlayer = new EchoPlayer(
  () => controller.isSpeaking,
  (...args) => console.log(LOG, ...args),
);

/** Ordbanken bor her — lastes én gang for hele nettleseren, ikke per fane. */
let predictorPromise: Promise<Predictor> | null = null;

function getPredictor(): Promise<Predictor> {
  if (!predictorPromise) {
    predictorPromise = Predictor.fromUrl(chrome.runtime.getURL("dict/nb.txt")).then((p) => {
      console.log(LOG, `ordbank lastet: ${p.size} former`);
      return p;
    });
    predictorPromise.catch((err) => {
      console.error(LOG, "kunne ikke laste ordbank:", err);
      predictorPromise = null; // prøv igjen neste gang
    });
  }
  return predictorPromise;
}

function emit(tabId: number, event: TtsEvent): void {
  void chrome.runtime.sendMessage({ type: "ss-event", tabId, event }).catch((err) => {
    console.warn(LOG, "kunne ikke sende hendelse:", err);
  });
}

// VIKTIG: meldingslytteren registreres FØR alt som kan feile — dør noe
// annet under oppstart, skal opplesing likevel fungere.
chrome.runtime.onMessage.addListener(
  (msg: OffscreenSpeak | OffscreenStop | OffscreenEcho | OffscreenSuggest, _sender, sendResponse) => {
  if (!("target" in msg) || msg.target !== "offscreen") return;

  if (msg.type === "ss-offscreen-stop") {
    controller.stop();
    echoPlayer.stop();
    sendResponse();
    return;
  }

  if (msg.type === "ss-offscreen-echo") {
    void echoPlayer.echo(msg.kind, msg.text, msg.rate ?? 1);
    sendResponse();
    return;
  }

  if (msg.type === "ss-offscreen-suggest") {
    void (async () => {
      try {
        const predictor = await getPredictor();
        sendResponse(msg.prefix ? predictor.suggest(msg.prefix, msg.max) : []);
      } catch {
        sendResponse([]);
      }
    })();
    return true; // async svar
  }

  if (msg.type === "ss-offscreen-speak") {
    const { text, tabId, rate } = msg;
    console.log(LOG, `starter opplesing (${text.length} tegn, hastighet ${rate ?? "uendret"})`);
    controller.stop();
    if (typeof rate === "number") controller.setRate(rate);
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
  chrome.storage?.local
    ?.get({ rate: 1, echoLetters: false })
    .then(({ rate, echoLetters }) => {
      console.log(LOG, "hastighet fra innstillinger:", rate);
      controller.setRate(rate as number);
      // Generer bokstavklippene i bakgrunnen så første ekte tastetrykk er raskt
      if (echoLetters) void echoPlayer.prewarm();
    })
    .catch((err: unknown) => console.warn(LOG, "kunne ikke lese innstillinger:", err));
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.rate) {
      console.log(LOG, "ny hastighet:", changes.rate.newValue);
      controller.setRate(changes.rate.newValue as number);
    }
    if (changes.echoLetters?.newValue === true) void echoPlayer.prewarm();
  });
} catch (err) {
  console.warn(LOG, "innstillinger utilgjengelige:", err);
}

console.log(LOG, "klar. Stemme-base:", chrome.runtime.getURL("voices"));
