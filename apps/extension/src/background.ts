/**
 * Service worker: ruter meldinger mellom content scripts og offscreen-dokumentet.
 * Selve talesyntesen og avspillingen skjer i offscreen-dokumentet
 * (service workers har verken lyd eller DOM).
 */
import type { AnyMessage, TtsEvent } from "./messages.js";
import { getLicenseClient, licenseState, invalidateLicenseCache, harFunksjon } from "./license.js";
import { FEATURE_FOR_MESSAGE } from "./license-config.js";

const OFFSCREEN_URL = "offscreen.html";

/* ---------- Lisens: døgnlig fornyelse i bakgrunnen ---------- */

const FORNY_ALARM = "ordlyd-forny-lisens";

/**
 * chrome.alarms, ikke setTimeout: service workeren blir drept etter ~30 s
 * uten aktivitet, og da forsvinner enhver timer med den. Alarmen overlever.
 */
function planleggFornyelse(): void {
  chrome.alarms.create(FORNY_ALARM, { periodInMinutes: 240, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(planleggFornyelse);
chrome.runtime.onStartup.addListener(planleggFornyelse);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FORNY_ALARM) return;
  void (async () => {
    try {
      const fornyet = await (await getLicenseClient()).refresh();
      if (fornyet) {
        invalidateLicenseCache();
        console.info("[Ordlyd SW] lisensen er fornyet");
      }
    } catch (err) {
      // Fornyelse som feiler er ufarlig: kvitteringen beholdes til den
      // løper ut av seg selv. Vi prøver igjen ved neste alarm.
      console.warn("[Ordlyd SW] fornyelse feilet:", err);
    }
  })();
});
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

/**
 * Tomt svar når funksjonen ikke er lisensiert. Formen må matche det
 * avsenderen forventer, ellers får content scriptet en tolkningsfeil i
 * stedet for «ingen forslag».
 */
function tomtSvar(type: string): unknown {
  if (type === "ss-dict") return { bm: [], nn: [] };
  return [];
}

chrome.runtime.onMessage.addListener((msg: AnyMessage, sender, sendResponse) => {
  (async () => {
    let response: unknown;

    /* Lisensporten. Ligger her fordi ALLE funksjonsforespørsler går gjennom
       service workeren — ett sted å håndheve, ett sted å endre. «ss-stop»
       er med vilje utenfor: å stoppe lyd må alltid virke. */
    const kreverFunksjon = FEATURE_FOR_MESSAGE[msg.type];
    if (kreverFunksjon && !(await harFunksjon(kreverFunksjon))) {
      if (msg.type === "ss-speak" && sender.tab?.id != null) {
        const s = await licenseState();
        sendEventToTab(sender.tab.id, {
          kind: "error",
          message:
            s.status === "ulisensiert"
              ? "Ordlyd er ikke aktivert. Åpne utvidelsen og logg inn med e-post og lisenskode."
              : "Lisensen har løpt ut. Kontakt den som ga deg lisenskoden.",
        });
      }
      sendResponse(tomtSvar(msg.type));
      return;
    }

    switch (msg.type) {
      case "ss-license-state": {
        response = await licenseState(true);
        break;
      }
      case "ss-license-login": {
        const klient = await getLicenseClient();
        const r = await klient.login(msg.epost, msg.kode);
        invalidateLicenseCache();
        if (r.ok) planleggFornyelse();
        response = r;
        break;
      }
      case "ss-license-logout": {
        await (await getLicenseClient()).logout();
        invalidateLicenseCache();
        response = { ok: true };
        break;
      }
      case "ss-license-refresh": {
        try {
          const fornyet = await (await getLicenseClient()).refresh(true);
          invalidateLicenseCache();
          response = { ok: true, fornyet };
        } catch {
          response = { ok: false, fornyet: false };
        }
        break;
      }
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
