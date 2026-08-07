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

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

/** Lytt på endringer; callback får alltid komplette innstillinger. */
export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    void getSettings().then(cb);
  });
}
