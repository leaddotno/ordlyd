/** Meldingsprotokoll mellom content script ↔ service worker ↔ offscreen-dokument. */

export interface SpeakRequest {
  type: "ss-speak";
  text: string;
}

export interface StopRequest {
  type: "ss-stop";
}

/** SW → offscreen */
export interface OffscreenSpeak {
  type: "ss-offscreen-speak";
  target: "offscreen";
  text: string;
  tabId: number;
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
  | OffscreenSpeak
  | OffscreenStop
  | EventEnvelope;
