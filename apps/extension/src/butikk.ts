/**
 * Alt som skiller Edge-pakken fra Chrome-pakken.
 *
 * Utvidelsen er ellers bit for bit den samme — Edge *er* Chromium, og vi
 * bruker ikke én butikkspesifikk API. Men to ting må stemme med
 * nettleseren brukeren faktisk sitter i:
 *
 *   1. Adressen til utvidelsessiden. `edge://extensions` finnes ikke i
 *      Chrome, og `chrome://extensions` finnes ikke i Edge. Står det feil,
 *      får brukeren en beskjed som ikke virker.
 *   2. Produktnøkkelen mot lisensserveren, slik at vi kan se hvilken
 *      nettleser folk bruker og sende «Oppdater» til riktig butikk.
 *
 * Valget skjer ved BYGGING, ikke ved kjøring. Én pakke per butikk er
 * hele poenget: Chrome-pakken skal ikke inneholde ordet «edge», og
 * omvendt. En kjøretidssjekk ville lagt begge variantene i begge
 * pakkene.
 *
 * `__BUTIKK__` erstattes av Vite. Faller tilbake på "edge" der define
 * ikke gjelder — typesjekk, røyktester gjennom tsx — slik at de
 * fortsetter å virke uten ekstra oppsett.
 */

declare const __BUTIKK__: string | undefined;

export type Butikk = "edge" | "chrome";

function velgButikk(): Butikk {
  const v = typeof __BUTIKK__ === "string" ? __BUTIKK__ : "edge";
  return v === "chrome" ? "chrome" : "edge";
}

export const BUTIKK: Butikk = velgButikk();

/** Nettleserens egen utvidelsesside. Kan ikke åpnes av en utvidelse — bare kopieres. */
export const UTVIDELSESSIDE = BUTIKK === "chrome" ? "chrome://extensions" : "edge://extensions";

/** Navnet på nettleseren, til bruk i tekst mot brukeren. */
export const NETTLESER = BUTIKK === "chrome" ? "Chrome" : "Edge";

/** Butikkens navn, til bruk i tekst mot brukeren. */
export const BUTIKKNAVN = BUTIKK === "chrome" ? "Chrome Web Store" : "Microsoft Edge Add-ons";
