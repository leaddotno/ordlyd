/** Delte innstillinger — lagres i chrome.storage.sync (følger brukerens profil). */

export interface Settings {
  /** Hovedbryter for hele utvidelsen */
  enabled: boolean;
  /** Avspillingshastighet 0.5–2.0 */
  rate: number;
  /** Ordforslag mens man skriver */
  prediction: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  rate: 1.0,
  prediction: true,
};

/**
 * chrome.storage finnes ikke overalt content scriptet kjører (sandboxede
 * iframes med all_frames). Da faller vi tilbake på standardinnstillinger
 * i stedet for å krasje hele scriptet.
 *
 * storage.local, ikke storage.sync: sync kan være deaktivert/upålitelig på
 * enkelte Edge-profiler (styrte skolemaskiner). Innstillingene er uansett
 * ikke kritiske å synkronisere mellom maskiner ennå.
 */
function hasStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

export async function getSettings(): Promise<Settings> {
  if (!hasStorage()) return DEFAULT_SETTINGS;
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (!hasStorage()) throw new Error("chrome.storage er ikke tilgjengelig");
  await chrome.storage.local.set(patch);
}

/** Lytt på endringer; callback får alltid komplette innstillinger. */
export function onSettingsChanged(cb: (s: Settings) => void): void {
  if (!hasStorage()) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    void getSettings().then(cb);
  });
}
