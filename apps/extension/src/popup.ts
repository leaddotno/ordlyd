import { getSettings, saveSettings, type Settings, type Theme } from "./settings.js";
import { visLogoEllerTekst } from "./logo.js";
import type { LicenseState } from "@ordlyd/license-client";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

visLogoEllerTekst("logo", "tittel", "🔊 Ordlyd");

const enabled = $<HTMLInputElement>("enabled");
const rate = $<HTMLInputElement>("rate");
const rateVal = $<HTMLSpanElement>("rateVal");
const prediction = $<HTMLInputElement>("prediction");
const spellcheck = $<HTMLInputElement>("spellcheck");
const dictionaryBox = $<HTMLInputElement>("dictionaryBox");
const echoLetters = $<HTMLInputElement>("echoLetters");
const echoWords = $<HTMLInputElement>("echoWords");
const echoSentences = $<HTMLInputElement>("echoSentences");
const themeStandard = $<HTMLButtonElement>("themeStandard");
const themeDark = $<HTMLButtonElement>("themeDark");
const status = $<HTMLDivElement>("status");

let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** Synlig kvittering: brukeren skal SE at innstillingen faktisk ble lagret. */
function save(patch: Partial<Settings>): void {
  saveSettings(patch)
    .then(() => {
      status.textContent = "Lagret ✓";
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        status.textContent = "Marker tekst på en nettside og trykk «Les opp».";
      }, 1500);
    })
    .catch((err) => {
      status.textContent = `Kunne ikke lagre: ${err instanceof Error ? err.message : err}`;
      console.error("[Ordlyd popup]", err);
    });
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  themeStandard.setAttribute("aria-pressed", String(theme === "standard"));
  themeDark.setAttribute("aria-pressed", String(theme === "dark"));
}

function showRate(value: number): void {
  rateVal.textContent = `${value.toFixed(1)}×`;
}

getSettings()
  .then((s) => {
    enabled.checked = s.enabled;
    rate.value = String(s.rate);
    prediction.checked = s.prediction;
    spellcheck.checked = s.spellcheck;
    dictionaryBox.checked = s.dictionaryBox;
    echoLetters.checked = s.echoLetters;
    echoWords.checked = s.echoWords;
    echoSentences.checked = s.echoSentences;
    showRate(s.rate);
    applyTheme(s.theme);
  })
  .catch((err) => {
    status.textContent = `Kunne ikke lese innstillinger: ${err}`;
  });

enabled.addEventListener("change", () => save({ enabled: enabled.checked }));
prediction.addEventListener("change", () => save({ prediction: prediction.checked }));
spellcheck.addEventListener("change", () => save({ spellcheck: spellcheck.checked }));
dictionaryBox.addEventListener("change", () => save({ dictionaryBox: dictionaryBox.checked }));
echoLetters.addEventListener("change", () => save({ echoLetters: echoLetters.checked }));
echoWords.addEventListener("change", () => save({ echoWords: echoWords.checked }));
echoSentences.addEventListener("change", () => save({ echoSentences: echoSentences.checked }));
rate.addEventListener("input", () => {
  const value = Number(rate.value);
  showRate(value);
  save({ rate: value });
});

for (const [btn, theme] of [
  [themeStandard, "standard"],
  [themeDark, "dark"],
] as Array<[HTMLButtonElement, Theme]>) {
  btn.addEventListener("click", () => {
    applyTheme(theme);
    save({ theme });
  });
}

/* ============================ Lisens ============================ */

const loginCard = $<HTMLDivElement>("loginCard");
const licCard = $<HTMLDivElement>("licCard");
const masterCard = $<HTMLDivElement>("masterCard");
const epost = $<HTMLInputElement>("epost");
const kode = $<HTMLInputElement>("kode");
const loginFeil = $<HTMLDivElement>("loginFeil");
const loginBtn = $<HTMLButtonElement>("loginBtn");
const licBadge = $<HTMLSpanElement>("licBadge");
const licInfo = $<HTMLSpanElement>("licInfo");
const licVarsel = $<HTMLDivElement>("licVarsel");
const sjekkBtn = $<HTMLButtonElement>("sjekkBtn");
const loggUtBtn = $<HTMLButtonElement>("loggUtBtn");

const innstillingsseksjoner = () => [...document.querySelectorAll("details")] as HTMLDetailsElement[];

/** Grupperer koden mens man skriver: «1234567» blir «123 4567». */
kode.addEventListener("input", () => {
  const sifre = kode.value.replace(/\D/g, "").slice(0, 7);
  kode.value = sifre.length > 3 ? `${sifre.slice(0, 3)} ${sifre.slice(3)}` : sifre;
});

const PLAN_NAVN: Record<string, string> = {
  medlem: "Medlemslisens",
  skole: "Skolelisens",
  prove: "Prøvelisens",
  apen: "Åpen lisens",
};

const norskDato = (sek: number): string =>
  new Date(sek * 1000).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });

/**
 * Hva brukeren skal se. Kjernen i denne funksjonen er skillet mellom
 * LISENSEN og KONTAKTEN med serveren:
 *
 *  - En løpende lisens har ingen sluttdato, og skal ikke ha nedtelling.
 *    Den fornyes i det stille, og tallet «dager igjen» hører til
 *    fornyingsklokka — ikke til noe brukeren må passe på.
 *  - Nedtelling vises bare når det er noe å gjøre: når maskinen ikke har
 *    nådd serveren på lenge, eller når lisensen faktisk har en sluttdato.
 */
function lisensTekst(s: LicenseState): { merke: string; klasse: string; linje: string; varsler: string[] } {
  const type = s.lisenstype ? PLAN_NAVN[s.lisenstype] ?? null : null;
  const varsler: string[] = [];

  if (s.klokkeAvvik) {
    varsler.push("Datoen på maskinen ser ut til å være feil. Alt virker, men sjekk klokka.");
  }
  if (s.sisteAvslag === "stengt") {
    varsler.push("Lisensen er stengt av den som ga deg koden.");
  }

  if (s.status === "utgatt") {
    return {
      merke: "utløpt",
      klasse: "degradert",
      linje: s.lisensSlutt ? `Lisensen gikk ut ${norskDato(s.lisensSlutt)}` : "Lisensen har gått ut",
      varsler: [
        "Opplesing virker fortsatt. Skrivehjelpen er slått av. Kontakt den som ga deg lisenskoden for å forlenge.",
        ...varsler,
      ],
    };
  }

  if (s.status === "degradert") {
    return {
      merke: "begrenset",
      klasse: "degradert",
      linje: "Har ikke nådd lisensserveren på lenge",
      varsler: [
        "Opplesing virker fortsatt, men skrivehjelpen er slått av. Koble maskinen til internett, eller trykk «Sjekk lisensen nå».",
        ...varsler,
      ],
    };
  }

  if (s.status === "varsel") {
    const dager = s.dagerTilKontaktfrist ?? 0;
    return {
      merke: "sjekk nett",
      klasse: "varsel",
      linje: type ?? "Lisensen er aktiv",
      varsler: [
        `Ordlyd har ikke nådd lisensserveren på en stund. Alt virker i ${dager} dager til. ` +
          "Er maskinen på nett, ordner det seg av seg selv.",
        ...varsler,
      ],
    };
  }

  // Aktiv. Her er poenget: ingen nedtelling med mindre lisensen faktisk
  // har en sluttdato.
  return {
    merke: "aktiv",
    klasse: "aktiv",
    linje: s.lisensSlutt
      ? `${type ?? "Lisensen"} · gyldig til ${norskDato(s.lisensSlutt)}`
      : `${type ?? "Lisensen"} · løpende, fornyes automatisk`,
    varsler,
  };
}

function visLisens(s: LicenseState): void {
  const ulisensiert = s.status === "ulisensiert";
  loginCard.classList.toggle("hidden", !ulisensiert);
  licCard.classList.toggle("hidden", ulisensiert);

  // Uten lisens er innstillingene meningsløse — skjul dem framfor å vise
  // brytere som ikke gjør noe.
  masterCard.classList.toggle("hidden", ulisensiert);
  for (const d of innstillingsseksjoner()) d.classList.toggle("hidden", ulisensiert);

  // Lenken til lisensbestilling vises bare når den er relevant — den som
  // alt har lisens skal ikke lete forbi den hver gang popupen åpnes.
  $("ingenLisens").classList.toggle("hidden", !ulisensiert);

  if (ulisensiert) {
    status.textContent = s.feil
      ? "Lisensen kunne ikke verifiseres. Logg inn på nytt."
      : "Aktiver Ordlyd for å komme i gang.";
    return;
  }

  const t = lisensTekst(s);
  licBadge.className = `badge ${t.klasse}`;
  licBadge.textContent = t.merke;
  licInfo.textContent = [s.epostMaskert, t.linje].filter(Boolean).join(" · ");
  licVarsel.textContent = t.varsler.join(" ");
  status.textContent = "Marker tekst på en nettside og trykk «Les opp».";
}

async function hentLisens(): Promise<void> {
  try {
    const s = (await chrome.runtime.sendMessage({ type: "ss-license-state" })) as LicenseState;
    if (s) visLisens(s);
  } catch (err) {
    status.textContent = "Fikk ikke kontakt med utvidelsen. Prøv å laste den inn på nytt.";
    console.error("[Ordlyd popup]", err);
  }
}

loginBtn.addEventListener("click", async () => {
  loginFeil.textContent = "";
  const e = epost.value.trim();
  const k = kode.value.replace(/\D/g, "");
  if (!e.includes("@")) return void (loginFeil.textContent = "Skriv inn e-postadressen din.");
  if (k.length !== 7) return void (loginFeil.textContent = "Lisenskoden er sju siffer.");

  loginBtn.disabled = true;
  loginBtn.textContent = "Aktiverer …";
  try {
    const r = (await chrome.runtime.sendMessage({ type: "ss-license-login", epost: e, kode: k })) as
      | { ok: true }
      | { ok: false; feil: string };
    if (r?.ok) {
      kode.value = "";
      await hentLisens();
    } else {
      loginFeil.textContent = r?.feil ?? "Aktiveringen mislyktes.";
    }
  } catch {
    loginFeil.textContent = "Fikk ikke kontakt med utvidelsen.";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Aktiver";
  }
});

sjekkBtn.addEventListener("click", async () => {
  sjekkBtn.disabled = true;
  const opprinnelig = sjekkBtn.textContent;
  sjekkBtn.textContent = "Sjekker …";
  try {
    const r = (await chrome.runtime.sendMessage({ type: "ss-license-refresh" })) as { fornyet: boolean };
    await hentLisens();
    licVarsel.textContent = r?.fornyet
      ? "Lisensen er fornyet."
      : licVarsel.textContent || "Fikk ikke ny kvittering nå. Den gamle gjelder fortsatt.";
  } finally {
    sjekkBtn.disabled = false;
    sjekkBtn.textContent = opprinnelig;
  }
});

$<HTMLButtonElement>("omBtn").addEventListener("click", () => {
  // Egen fane: «Om»-innholdet er for mye for en 360 px bred popup, og
  // siden kan gjenbrukes av PC-appen senere.
  void chrome.tabs.create({ url: chrome.runtime.getURL("om.html") });
});

loggUtBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "ss-license-logout" });
  epost.value = "";
  kode.value = "";
  await hentLisens();
});

void hentLisens();
