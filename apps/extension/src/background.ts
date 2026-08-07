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
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: "Spiller av lokal talesyntese (tekst-til-tale)",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

/** Send til offscreen med retry — lytteren kan være et øyeblikk unna rett etter opprettelse. */
async function sendToOffscreen(msg: unknown): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await chrome.runtime.sendMessage(msg);
      return;
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
    switch (msg.type) {
      case "ss-speak": {
        const tabId = sender.tab?.id;
        if (tabId == null) return;
        try {
          await ensureOffscreen();
          await sendToOffscreen({
            type: "ss-offscreen-speak",
            target: "offscreen",
            text: msg.text,
            tabId,
          });
        } catch (err) {
          console.error("[Skrivestøtte SW] Klarte ikke å starte opplesing:", err);
          sendEventToTab(tabId, {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case "ss-stop": {
        try {
          await ensureOffscreen();
          await sendToOffscreen({ type: "ss-offscreen-stop", target: "offscreen" });
        } catch (err) {
          console.error("[Skrivestøtte SW] Stopp feilet:", err);
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
    sendResponse();
  })();
  return true; // hold meldingskanalen åpen for async svar
});
