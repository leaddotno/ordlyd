/** Meldingsprotokoll mellom content script ↔ service worker ↔ offscreen-dokument. */

export interface SpeakRequest {
  type: "ss-speak";
  text: string;
  /** Avspillingshastighet fra innstillingene — sendes med hver forespørsel
   *  så den virker uavhengig av offscreen-dokumentets livssyklus */
  rate?: number;
}

export interface StopRequest {
  type: "ss-stop";
}

/** Skriveekko: bokstav ved tastetrykk, ord ved ordgrense, setning ved .!? */
export type EchoKind = "letter" | "word" | "sentence";

export interface EchoRequest {
  type: "ss-echo";
  kind: EchoKind;
  text: string;
  rate?: number;
}

export interface OffscreenEcho {
  type: "ss-offscreen-echo";
  target: "offscreen";
  kind: EchoKind;
  text: string;
  rate?: number;
}

/** SW → offscreen */
export interface OffscreenSpeak {
  type: "ss-offscreen-speak";
  target: "offscreen";
  text: string;
  tabId: number;
  rate?: number;
}

export interface OffscreenStop {
  type: "ss-offscreen-stop";
  target: "offscreen";
}

/** offscreen → SW → content (videresendes til riktig fane) */
export type TtsEvent =
  | { kind: "sentence"; sentenceIndex: number; start: number; end: number }
  | { kind: "word"; globalWordIndex: number }
  | { kind: "download"; loaded: number; total: number }
  | { kind: "end"; stopped: boolean }
  | { kind: "error"; message: string };

export interface EventEnvelope {
  type: "ss-event";
  tabId: number;
  event: TtsEvent;
}

export type AnyMessage =
  | SpeakRequest
  | StopRequest
  | EchoRequest
  | OffscreenSpeak
  | OffscreenStop
  | OffscreenEcho
  | EventEnvelope;
