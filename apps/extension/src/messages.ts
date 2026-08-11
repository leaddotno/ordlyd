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

/** Ordforslag: content script spør, offscreen-dokumentet svarer (ordbanken bor der) */
export interface SuggestRequest {
  type: "ss-suggest";
  prefix: string;
  max: number;
}

export interface OffscreenSuggest {
  type: "ss-offscreen-suggest";
  target: "offscreen";
  prefix: string;
  max: number;
}

/** Stavekontroll: sjekk fullført ord; svar er «Mente du»-forslag (tomt = OK) */
export interface CheckRequest {
  type: "ss-check";
  word: string;
}

export interface OffscreenCheck {
  type: "ss-offscreen-check";
  target: "offscreen";
  word: string;
}

/** Ordbok: slå opp et ord i Bokmålsordboka og Nynorskordboka samtidig */
export interface DictRequest {
  type: "ss-dict";
  word: string;
}

export interface OffscreenDict {
  type: "ss-offscreen-dict";
  target: "offscreen";
  word: string;
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
  | SuggestRequest
  | CheckRequest
  | DictRequest
  | OffscreenSpeak
  | OffscreenStop
  | OffscreenEcho
  | OffscreenSuggest
  | OffscreenCheck
  | OffscreenDict
  | EventEnvelope;
