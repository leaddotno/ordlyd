/**
 * Rollemodellen og kundeavgrensningen.
 *
 * Dette er stedet med størst skadepotensial i hele adminsystemet: én
 * glemt avgrensning, og en kunde ser en annen kundes medlemsliste.
 * Modulen er derfor bygget slik at avgrensningen ikke er noe man må
 * *huske* — hver rapportspørring tar `Innlogget` som parameter, og
 * TypeScript nekter å kompilere et kall uten. Å gi bort alle kunder
 * krever et aktivt `kunder: null`, som er synlig i koden.
 *
 * Forskjellen mellom forvalter og kundeadmin er bare OMFANG, ikke
 * rettigheter. Det er en bevisst forenkling: én tillatelsesmodell å
 * teste, og en medarbeider flyttes mellom bred og smal tilgang ved å
 * endre rollen — ikke ved å krysse av i en rettighetsliste som ingen
 * holder oversikt over etter et halvår.
 */

import { forbidden, type HttpResponse } from "./runtime.js";

export type Rolle = "eier" | "forvalter" | "kundeadmin" | "revisor";

/** Hvor tilgangen kommer fra. Avgjør hva som havner i revisjonsloggen. */
export type Tilgangskilde = "okt" | "apitoken" | "bootstrap";

export interface Innlogget {
  adminId: string;
  navn: string;
  epost: string;
  rolle: Rolle;
  /**
   * null = alle kunder. Ellers nøyaktig de tildelte.
   *
   * null er BARE lovlig for eier og forvalter — se `omfangErGyldig`.
   * En tom liste er ikke det samme som null: den betyr «ingen kunder»,
   * og en slik konto ser ingenting. Det er riktig oppførsel for en
   * kundeadmin som har fått alle kundene sine fjernet.
   */
  kunder: string[] | null;
  kilde: Tilgangskilde;
}

/* ------------------------------------------------------------------ *
 * Rettigheter
 * ------------------------------------------------------------------ */

/** Revisor er den eneste rollen som ikke kan endre noe. */
export const kanEndre = (meg: Innlogget): boolean => meg.rolle !== "revisor";

/** Bare eier oppretter, endrer og sperrer administratorer. */
export const kanStyreAdministratorer = (meg: Innlogget): boolean => meg.rolle === "eier";

/**
 * Globale innstillinger — prøvelengde, om registrering er åpen. Bare
 * eier, fordi de gjelder hele tjenesten og ikke én kunde.
 */
export const kanEndreGlobaltOppsett = (meg: Innlogget): boolean => meg.rolle === "eier";

/** Kan opprette nye kunder. En kundeadmin styrer sine, men lager ikke nye. */
export const kanOppretteKunder = (meg: Innlogget): boolean =>
  meg.rolle === "eier" || meg.rolle === "forvalter";

/**
 * Rollene som må ha bekreftet totrinn før de slipper inn.
 * Revisor er unntatt etter avgjørelse, men kan kreves per konto gjennom
 * `krev_totrinn` i databasen — derfor tar funksjonen flagget med.
 */
export function krevesTotrinn(rolle: Rolle, krevTotrinnPaaKonto: boolean): boolean {
  if (rolle === "revisor") return krevTotrinnPaaKonto;
  return true;
}

/* ------------------------------------------------------------------ *
 * Kundeavgrensning
 * ------------------------------------------------------------------ */

/** Ser den innloggede denne kunden i det hele tatt? */
export function serKunde(meg: Innlogget, tenantId: string): boolean {
  return meg.kunder === null || meg.kunder.includes(tenantId);
}

/**
 * Omfanget til bruk i spørringer.
 *
 * Returnerer `null` for de som ser alt, ellers listen. Spørringene
 * skriver mønsteret:
 *
 *   where (${filter === null} or t.id = any(${filter ?? []}))
 *
 * Merk at en tom liste gir `any('{}')`, som ikke treffer noe — riktig
 * for en konto uten tildelte kunder.
 */
export const kundefilter = (meg: Innlogget): string[] | null => meg.kunder;

/**
 * Er kombinasjonen rolle/omfang lovlig?
 *
 * Håndheves her og ikke i databasen, fordi regelen avhenger av to
 * tabeller samtidig. Kalles ved opprettelse og endring av konto, og ved
 * innlogging — slik at en konto som er blitt ugyldig av en manuell
 * SQL-endring blir avvist framfor å få for mye.
 */
export function omfangErGyldig(rolle: Rolle, kunder: string[] | null): boolean {
  if (rolle === "eier" || rolle === "forvalter") return kunder === null;
  // kundeadmin og revisor: må ha minst én tildelt kunde.
  return Array.isArray(kunder) && kunder.length > 0;
}

export function forklarOmfang(rolle: Rolle): string {
  return rolle === "eier" || rolle === "forvalter"
    ? "Har tilgang til alle kunder, og skal ikke tildeles enkeltkunder."
    : "Må tildeles minst én kunde. Ser ingenting utenfor dem.";
}

/* ------------------------------------------------------------------ *
 * Vakter for endepunktene
 *
 * Returnerer null når det er i orden, ellers svaret som skal sendes —
 * samme mønster som `requireAdmin` bruker fra før, slik at endepunktene
 * ser like ut.
 * ------------------------------------------------------------------ */

export function krevEndring(meg: Innlogget): HttpResponse | null {
  return kanEndre(meg)
    ? null
    : forbidden("revisor-kan-ikke-endre");
}

export function krevAdministratorstyring(meg: Innlogget): HttpResponse | null {
  return kanStyreAdministratorer(meg)
    ? null
    : forbidden("bare-eier");
}

export function krevGlobaltOppsett(meg: Innlogget): HttpResponse | null {
  return kanEndreGlobaltOppsett(meg) ? null : forbidden("bare-eier");
}

export function krevKundeoppretting(meg: Innlogget): HttpResponse | null {
  return kanOppretteKunder(meg) ? null : forbidden("ikke-tillatt");
}

/**
 * Vakt for en handling på en bestemt kunde.
 *
 * Svarer med 404 og ikke 403 når kunden ligger utenfor omfanget. Det er
 * med vilje: forskjellen mellom «finnes ikke» og «finnes, men ikke din»
 * er i seg selv en opplysning. En kundeadmin skal ikke kunne kartlegge
 * hvilke andre kunder som finnes ved å prøve seg fram med id-er.
 */
export function krevKunde(meg: Innlogget, tenantId: string): HttpResponse | null {
  if (!serKunde(meg, tenantId)) return { status: 404, body: { feil: "ukjent-kunde" } };
  return null;
}

/* ------------------------------------------------------------------ *
 * Revisjonsloggen
 * ------------------------------------------------------------------ */

/**
 * Hvem får se en logglinje?
 *
 *  - Linje med kunde: den som har kunden i sitt omfang.
 *  - Linje uten kunde (globale innstillinger, administratorstyring):
 *    bare eier og forvalter. En kundeadmin skal ikke se at systemet har
 *    andre kunder, og en revisor er der for sin egen kunde — ikke for
 *    å følge med på driften.
 */
export function serLoggLinje(meg: Innlogget, tenantId: string | null): boolean {
  if (tenantId === null) return meg.kunder === null;
  return serKunde(meg, tenantId);
}
