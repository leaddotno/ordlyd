import { getSettings, saveSettings, type Settings, type Theme } from "./settings.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
      console.error("[Skrivestøtte popup]", err);
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
