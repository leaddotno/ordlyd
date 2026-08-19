/**
 * «Om Ordlyd» — lisensinformasjon, versjon og oppdatering.
 *
 * Siden spør service workeren om alt; den er eneste kilde til sannhet om
 * lisensen, og den eneste som kan spørre nettleseren om oppdateringer.
 */

import { visLogoEllerTekst } from "./logo.js";
import { UTVIDELSESSIDE, NETTLESER } from "./butikk.js";
import type { LicenseState } from "@ordlyd/license-client";
import type { VersionInfoResponse, CheckUpdateResponse } from "./messages.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

visLogoEllerTekst("logo", "tittel", "🔊 Om Ordlyd");

const PLAN_NAVN: Record<string, string> = {
  medlem: "Medlemslisens",
  skole: "Skolelisens",
  prove: "Prøvelisens",
  apen: "Åpen lisens",
};

const norskDato = (sek: number): string =>
  new Date(sek * 1000).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });

const norskDatoTid = (sek: number): string =>
  new Date(sek * 1000).toLocaleString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ---------------------------- Lisens ---------------------------- */

function visLisens(s: LicenseState): void {
  $("lisensLaster").classList.add("hidden");
  $("lisensDl").classList.remove("hidden");

  const merke = $<HTMLSpanElement>("lStatus");
  const varsel = $<HTMLDivElement>("lVarsel");

  if (s.status === "ulisensiert") {
    merke.className = "badge degradert";
    merke.textContent = "ikke aktivert";
    $("lType").textContent = "—";
    $("lGyldig").textContent = "—";
    $("lKunde").textContent = "—";
    $("lEpost").textContent = "—";
    $("lBekreftet").textContent = "—";
    varsel.className = "melding warn";
    // Statisk markering, ingen brukerdata — trygt med innerHTML her, og
    // nødvendig for at lenken skal være klikkbar.
    varsel.innerHTML =
      "Ordlyd er ikke aktivert på denne maskinen. Åpne utvidelsen og logg inn med e-post og lisenskode.<br />" +
      'Har du ikke lisens? <a href="https://www.ordlyd.no/lisens" target="_blank" rel="noopener">' +
      "Besøk www.ordlyd.no/lisens</a> og aktiver en gratis tilgang.";
    return;
  }

  const merkeTekst =
    s.status === "aktiv" ? "aktiv" : s.status === "varsel" ? "sjekk nett" : s.status === "utgatt" ? "utløpt" : "begrenset";
  const merkeKlasse = s.status === "aktiv" ? "aktiv" : s.status === "varsel" ? "varsel" : "degradert";
  merke.className = `badge ${merkeKlasse}`;
  merke.textContent = merkeTekst;

  $("lType").textContent = s.lisenstype ? PLAN_NAVN[s.lisenstype] ?? s.lisenstype : "Ukjent";

  // Her ligger hele poenget: en løpende lisens får ingen nedtelling.
  $("lGyldig").textContent = s.lisensSlutt
    ? `Til og med ${norskDato(s.lisensSlutt)}`
    : "Løpende — ingen sluttdato";

  $("lKunde").textContent = s.kunde ?? "—";
  $("lEpost").textContent = s.epostMaskert ?? "—";
  $("lBekreftet").textContent = s.sisteSuksessSec ? norskDatoTid(s.sisteSuksessSec) : "Ikke ennå";

  const varsler: string[] = [];
  if (s.status === "utgatt") {
    varsler.push("Lisensperioden er over. Opplesing virker fortsatt, men skrivehjelpen er slått av.");
  }
  if (s.status === "degradert") {
    varsler.push("Ordlyd har ikke nådd lisensserveren på over to måneder. Opplesing virker fortsatt. Koble maskinen til internett, så ordner det seg av seg selv.");
  }
  if (s.status === "varsel") {
    varsler.push(`Ordlyd har ikke nådd lisensserveren på en stund. Alt virker i ${s.dagerTilKontaktfrist ?? 0} dager til.`);
  }
  if (s.sisteAvslag === "stengt") {
    varsler.push("Lisensen er stengt av den som ga deg koden.");
  }
  if (s.klokkeAvvik) {
    varsler.push("Datoen på maskinen ser ut til å være feil. Alt virker, men sjekk klokka.");
  }
  varsel.className = `melding ${s.status === "aktiv" ? "ok" : "warn"}`;
  varsel.textContent = varsler.join(" ");
}

/* ---------------------------- Versjon ---------------------------- */

/** Sammenligner «0.10.2» og «0.9.9» riktig — tallvis, ikke som tekst. */
function nyereEnn(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

let venterPaaOmstart: string | null = null;

function visVersjon(v: VersionInfoResponse): void {
  $("vInstallert").textContent = v.installert;
  $("vNyeste").textContent = v.nyeste ?? "Ukjent — fikk ikke kontakt med serveren";
  $("vMerknad").textContent = v.merknad ?? "";

  venterPaaOmstart = v.venterPaaOmstart;
  const melding = $<HTMLDivElement>("vMelding");

  if (venterPaaOmstart) {
    melding.className = "melding warn";
    melding.textContent = `Versjon ${venterPaaOmstart} er lastet ned og venter. Trykk «Ta i bruk nå» for å bytte med en gang.`;
    $("taIBruk").classList.remove("hidden");
    return;
  }
  if (v.nyeste && nyereEnn(v.nyeste, v.installert)) {
    melding.className = "melding warn";
    melding.textContent = `Versjon ${v.nyeste} er tilgjengelig. Trykk «Se etter oppdatering» for å hente den.`;
    return;
  }
  if (v.nyeste) {
    melding.className = "melding ok";
    melding.textContent = "Du har nyeste versjon.";
  }
}

$("sjekkOppdatering").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("sjekkOppdatering");
  const melding = $<HTMLDivElement>("vMelding");
  btn.disabled = true;
  const opprinnelig = btn.textContent;
  btn.textContent = "Ser etter …";
  try {
    const r = (await chrome.runtime.sendMessage({ type: "ss-check-update" })) as CheckUpdateResponse;
    if (r.status === "update_available") {
      venterPaaOmstart = r.versjon;
      melding.className = "melding warn";
      melding.textContent = `Versjon ${r.versjon} er klar. Trykk «Ta i bruk nå».`;
      $("taIBruk").classList.remove("hidden");
    } else if (r.status === "no_update") {
      melding.className = "melding ok";
      melding.textContent = "Du har nyeste versjon.";
    } else if (r.status === "throttled") {
      melding.className = "melding ok";
      melding.textContent = "Nettleseren sjekket nylig. Den ser etter oppdateringer automatisk hver femte time.";
    } else {
      melding.className = "melding warn";
      melding.textContent =
        "Denne installasjonen kan ikke sjekke oppdateringer automatisk — det skjer når utvidelsen er lastet inn manuelt under utvikling.";
    }
  } catch {
    melding.className = "melding warn";
    melding.textContent = "Fikk ikke kontakt med utvidelsen.";
  } finally {
    btn.disabled = false;
    btn.textContent = opprinnelig;
  }
});

$("taIBruk").addEventListener("click", () => {
  // Etter dette starter utvidelsen på nytt, og denne fanen mister
  // forbindelsen. Det er forventet.
  void chrome.runtime.sendMessage({ type: "ss-apply-update" });
  const melding = $<HTMLDivElement>("vMelding");
  melding.className = "melding ok";
  melding.textContent = "Oppdateringen tas i bruk. Lukk denne fanen og åpne Ordlyd på nytt.";
  $("taIBruk").classList.add("hidden");
});

$("kopierAdresse").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("kopierAdresse");
  try {
    await navigator.clipboard.writeText(UTVIDELSESSIDE);
    btn.textContent = "Kopiert ✓";
  } catch {
    btn.textContent = "Kunne ikke kopiere";
  }
  setTimeout(() => (btn.textContent = "Kopier adressen"), 2000);
});

/* ---------------------------- Oppstart ---------------------------- */

/*
 * Adressen til utvidelsessiden fylles inn fra koden framfor å stå i
 * HTML-en. HTML-filen er delt mellom begge butikkpakkene, og en
 * hardkodet «edge://extensions» der ville vært feil i Chrome-pakken —
 * og usynlig feil, siden siden ser helt riktig ut.
 */
for (const el of document.querySelectorAll("[data-utvidelsesside]")) {
  el.textContent = UTVIDELSESSIDE;
}
for (const el of document.querySelectorAll("[data-nettleser]")) {
  el.textContent = NETTLESER;
}

void (async () => {
  try {
    const s = (await chrome.runtime.sendMessage({ type: "ss-license-state" })) as LicenseState;
    if (s) visLisens(s);
  } catch {
    $("lisensLaster").textContent = "Fikk ikke kontakt med utvidelsen.";
  }
  try {
    const v = (await chrome.runtime.sendMessage({ type: "ss-version-info" })) as VersionInfoResponse;
    if (v) visVersjon(v);
  } catch {
    $("vNyeste").textContent = "Ukjent";
  }
})();
