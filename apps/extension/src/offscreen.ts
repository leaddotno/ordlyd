/**
 * Offscreen-dokument: kjører Piper-syntesen og spiller av lyd.
 * Sender ord-/setningshendelser tilbake via service workeren,
 * som videresender til riktig fane.
 */
import {
  SpeechController,
  configureLocalAssets,
  setPronunciationOverrides,
} from "@ordlyd/tts";
import { Dictionary, Predictor, SpellChecker } from "@ordlyd/writing";
import { EchoPlayer } from "./echo-player.js";
import type {
  OffscreenCheck,
  OffscreenDict,
  OffscreenEcho,
  OffscreenSpeak,
  OffscreenStop,
  OffscreenSuggest,
  TtsEvent,
} from "./messages.js";

const LOG = "[Ordlyd offscreen]";

// Fanger feil som ellers bare gir «Uncaught [object ErrorEvent]» i
// utvidelsens feil-liste, uten spor av hva som faktisk gikk galt.
self.addEventListener("error", (e) => {
  console.error(LOG, "uhåndtert feil:", e.message, e.filename, e.lineno);
});
self.addEventListener("unhandledrejection", (e) => {
  console.error(LOG, "uhåndtert promise-avvisning:", e.reason);
});

// Alt bundles i utvidelsespakken – null internettavhengighet ved bruk.
configureLocalAssets({
  voiceBaseUrl: chrome.runtime.getURL("voices"),
  onnxWasmBaseUrl: chrome.runtime.getURL("ort/"),
  piperWasmUrl: chrome.runtime.getURL("piper/piper_phonemize.wasm"),
  piperDataUrl: chrome.runtime.getURL("piper/piper_phonemize.data"),
});

// Uttale-overstyringer: ord fonemiseringen uttaler feil, med lydrett
// staving (redigerbar liste — assets/dict/uttale-overrides.json i repoet)
fetch(chrome.runtime.getURL("dict/uttale-overrides.json"))
  .then((res) => res.json())
  .then((map: Record<string, string>) => {
    setPronunciationOverrides(map);
    console.log(LOG, `uttale-overstyringer lastet: ${Object.keys(map).filter((k) => !k.startsWith("_")).length} ord`);
  })
  .catch((err) => console.warn(LOG, "kunne ikke laste uttale-overstyringer:", err));

const controller = new SpeechController();
const echoPlayer = new EchoPlayer(
  () => controller.isSpeaking,
  (...args) => console.log(LOG, ...args),
);

/**
 * Ordbanken bor her — lastes én gang for hele nettleseren, ikke per fane.
 * Prediksjonen bruker bare de vanligste formene (rask lineær skanning);
 * stavekontrollen bruker hele ordbanken (indeksert på lydnøkkel).
 */
const PREDICTION_LIMIT = 200_000;
interface Engines {
  predictor: Predictor;
  spell: SpellChecker;
}
let enginesPromise: Promise<Engines> | null = null;

function getEngines(): Promise<Engines> {
  if (!enginesPromise) {
    enginesPromise = (async () => {
      const res = await fetch(chrome.runtime.getURL("dict/nb.txt"));
      if (!res.ok) throw new Error(`ordbank: HTTP ${res.status}`);
      const words = (await res.text()).split("\n").filter(Boolean);
      const predictor = Predictor.fromWords(words.slice(0, PREDICTION_LIMIT));
      const t = Date.now();
      const spell = new SpellChecker(words);
      console.log(
        LOG,
        `ordbank lastet: ${words.length} former, stavekontroll-indeks bygget på ${Date.now() - t} ms`,
      );
      return { predictor, spell };
    })();
    enginesPromise.catch((err) => {
      console.error(LOG, "kunne ikke laste ordbank:", err);
      enginesPromise = null; // prøv igjen neste gang
    });
  }
  return enginesPromise;
}

/** Ordbøkene (UiB/Språkrådet) — shardet, lastes ved behov, lav minnebruk */
const ordbokBm = new Dictionary(chrome.runtime.getURL("dict/ordbok/bm"));
const ordbokNn = new Dictionary(chrome.runtime.getURL("dict/ordbok/nn"));

function emit(tabId: number, event: TtsEvent): void {
  void chrome.runtime.sendMessage({ type: "ss-event", tabId, event }).catch((err) => {
    console.warn(LOG, "kunne ikke sende hendelse:", err);
  });
}

// VIKTIG: meldingslytteren registreres FØR alt som kan feile — dør noe
// annet under oppstart, skal opplesing likevel fungere.
chrome.runtime.onMessage.addListener(
  (
    msg: OffscreenSpeak | OffscreenStop | OffscreenEcho | OffscreenSuggest | OffscreenCheck | OffscreenDict,
    _sender,
    sendResponse,
  ) => {
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
        const { predictor } = await getEngines();
        sendResponse(msg.prefix ? predictor.suggest(msg.prefix, msg.max) : []);
      } catch {
        sendResponse([]);
      }
    })();
    return true; // async svar
  }

  if (msg.type === "ss-offscreen-dict") {
    void (async () => {
      try {
        const [bm, nn] = await Promise.all([
          ordbokBm.lookup(msg.word).catch(() => []),
          ordbokNn.lookup(msg.word).catch(() => []),
        ]);
        sendResponse({ bm, nn });
      } catch {
        sendResponse({ bm: [], nn: [] });
      }
    })();
    return true; // async svar
  }

  if (msg.type === "ss-offscreen-check") {
    void (async () => {
      try {
        const { spell } = await getEngines();
        sendResponse(spell.suggest(msg.word, 3));
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
