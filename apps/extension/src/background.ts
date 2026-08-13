/**
 * Service worker: ruter meldinger mellom content scripts og offscreen-dokumentet.
 * Selve talesyntesen og avspillingen skjer i offscreen-dokumentet
 * (service workers har verken lyd eller DOM).
 */
import type { AnyMessage, TtsEvent } from "./messages.js";

const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        // DOM_PARSER i tillegg til AUDIO_PLAYBACK: med kun lyd-grunnen
        // stenges dokumentet 30 s etter siste avspilling — og da kastes
        // ordbanken ut og må lastes på nytt midt i skrivingen (merkbart
        // på svake maskiner). Ordbank-oppslagene holder dokumentet i live.
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.DOM_PARSER],
        justification: "Spiller av lokal talesyntese og holder ordbanken for ordforslag",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

/** Send til offscreen med retry — lytteren kan være et øyeblikk unna rett etter opprettelse. */
async function sendToOffscreen<T = unknown>(msg: unknown): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return (await chrome.runtime.sendMessage(msg)) as T;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function sendEventToTab(tabId: number, event: TtsEvent): void {
  chrome.tabs.sendMessage(tabId, event).catch(() => {
    // Fanen kan være lukket – ignorer
  });
}

chrome.runtime.onMessage.addListener((msg: AnyMessage, sender, sendResponse) => {
  (async () => {
    let response: unknown;
    switch (msg.type) {
      case "ss-suggest": {
        try {
          await ensureOffscreen();
          response = await sendToOffscreen<string[]>({
            type: "ss-offscreen-suggest",
            target: "offscreen",
            prefix: msg.prefix,
            max: msg.max,
          });
        } catch (err) {
          console.warn("[Ordlyd SW] forslag feilet:", err);
          response = [];
        }
        break;
      }
      case "ss-speak": {
        const tabId = sender.tab?.id;
        if (tabId == null) return;
        try {
          await ensureOffscreen();
          await sendToOffscreen({
            type: "ss-offscreen-speak",
            target: "offscreen",
            text: msg.text,
            rate: msg.rate,
            tabId,
          });
        } catch (err) {
          console.error("[Ordlyd SW] Klarte ikke å starte opplesing:", err);
          sendEventToTab(tabId, {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case "ss-check": {
        try {
          await ensureOffscreen();
          response = await sendToOffscreen<string[]>({
            type: "ss-offscreen-check",
            target: "offscreen",
            word: msg.word,
          });
        } catch (err) {
          console.warn("[Ordlyd SW] stavekontroll feilet:", err);
          response = [];
        }
        break;
      }
      case "ss-dict": {
        try {
          await ensureOffscreen();
          response = await sendToOffscreen({
            type: "ss-offscreen-dict",
            target: "offscreen",
            word: msg.word,
          });
        } catch (err) {
          console.warn("[Ordlyd SW] ordbok-oppslag feilet:", err);
          response = { bm: [], nn: [] };
        }
        break;
      }
      case "ss-echo": {
        try {
          await ensureOffscreen();
          await sendToOffscreen({
            type: "ss-offscreen-echo",
            target: "offscreen",
            kind: msg.kind,
            text: msg.text,
            rate: msg.rate,
          });
        } catch (err) {
          // Ekko er ikke kritisk — logg og gå videre
          console.warn("[Ordlyd SW] ekko feilet:", err);
        }
        break;
      }
      case "ss-stop": {
        try {
          await ensureOffscreen();
          await sendToOffscreen({ type: "ss-offscreen-stop", target: "offscreen" });
        } catch (err) {
          console.error("[Ordlyd SW] Stopp feilet:", err);
        }
        // Uansett: bekreft stopp til fanen så knappen aldri henger
        if (sender.tab?.id != null) {
          sendEventToTab(sender.tab.id, { kind: "end", stopped: true });
        }
        break;
      }
      case "ss-event": {
        sendEventToTab(msg.tabId, msg.event);
        break;
      }
    }
    sendResponse(response);
  })();
  return true; // hold meldingskanalen åpen for async svar
});
