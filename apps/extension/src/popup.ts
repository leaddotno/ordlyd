import { getSettings, saveSettings } from "./settings.js";

const enabled = document.getElementById("enabled") as HTMLInputElement;
const rate = document.getElementById("rate") as HTMLInputElement;
const rateVal = document.getElementById("rateVal") as HTMLSpanElement;
const prediction = document.getElementById("prediction") as HTMLInputElement;
const status = document.getElementById("status") as HTMLDivElement;

function showRate(value: number): void {
  rateVal.textContent = `${value.toFixed(1)}×`;
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** Synlig kvittering: brukeren skal SE at innstillingen faktisk ble lagret. */
function save(patch: Parameters<typeof saveSettings>[0]): void {
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

getSettings()
  .then((s) => {
    enabled.checked = s.enabled;
    rate.value = String(s.rate);
    prediction.checked = s.prediction;
    showRate(s.rate);
  })
  .catch((err) => {
    status.textContent = `Kunne ikke lese innstillinger: ${err}`;
  });

enabled.addEventListener("change", () => save({ enabled: enabled.checked }));
prediction.addEventListener("change", () => save({ prediction: prediction.checked }));
rate.addEventListener("input", () => {
  const value = Number(rate.value);
  showRate(value);
  save({ rate: value });
});
