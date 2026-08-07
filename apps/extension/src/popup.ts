import { getSettings, saveSettings } from "./settings.js";

const enabled = document.getElementById("enabled") as HTMLInputElement;
const rate = document.getElementById("rate") as HTMLInputElement;
const rateVal = document.getElementById("rateVal") as HTMLSpanElement;
const prediction = document.getElementById("prediction") as HTMLInputElement;

function showRate(value: number): void {
  rateVal.textContent = `${value.toFixed(1)}×`;
}

void getSettings().then((s) => {
  enabled.checked = s.enabled;
  rate.value = String(s.rate);
  prediction.checked = s.prediction;
  showRate(s.rate);
});

enabled.addEventListener("change", () => void saveSettings({ enabled: enabled.checked }));
prediction.addEventListener("change", () => void saveSettings({ prediction: prediction.checked }));
rate.addEventListener("input", () => {
  const value = Number(rate.value);
  showRate(value);
  void saveSettings({ rate: value });
});
