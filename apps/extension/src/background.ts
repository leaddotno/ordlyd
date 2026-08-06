/**
 * Service worker: ruter meldinger mellom content scripts og offscreen-dokumentet.
 * Selve talesyntesen og avspillingen skjer i offscreen-dokumentet
 * (service workers har verken lyd eller DOM).
 */
import type { AnyMessage } from "./messages.js";

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

chrome.runtime.onMessage.addListener((msg: AnyMessage, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "ss-speak": {
        const tabId = sender.tab?.id;
        if (tabId == null) return;
        await ensureOffscreen();
        await chrome.runtime.sendMessage({
          type: "ss-offscreen-speak",
          target: "offscreen",
          text: msg.text,
          tabId,
        });
        break;
      }
      case "ss-stop": {
        await ensureOffscreen();
        await chrome.runtime.sendMessage({ type: "ss-offscreen-stop", target: "offscreen" });
        break;
      }
      case "ss-event": {
        // Fra offscreen → videresend til riktig fane
        try {
          await chrome.tabs.sendMessage(msg.tabId, msg.event);
        } catch {
          // Fanen kan være lukket – ignorer
        }
        break;
      }
    }
    sendResponse();
  })();
  return true; // hold meldingskanalen åpen for async svar
});
