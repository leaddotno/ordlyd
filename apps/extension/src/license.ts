/**
 * Lisensklienten koblet til utvidelsens verden: chrome.storage for lagring,
 * og en overstyring av serveradressen som IT-avdelingen kan sette via Intune.
 *
 * Lever i service workeren, som er eneste kilde til sannhet om lisensen.
 * Content scripts og offscreen-dokumentet spør hit — de verifiserer aldri
 * selv, så det finnes bare ett sted å holde riktig.
 */

import { LicenseClient, type LicenseStorage, type StoredLicense, type LicenseState } from "@ordlyd/license-client";
import { BASE_URLS, PRODUCT, TRUSTED_KEYS } from "./license-config.js";

const LAGER_NOKKEL = "ordlyd_license";

const chromeStorage: LicenseStorage = {
  async read() {
    const o = await chrome.storage.local.get(LAGER_NOKKEL);
    return (o[LAGER_NOKKEL] as StoredLicense | undefined) ?? null;
  },
  async write(value) {
    await chrome.storage.local.set({ [LAGER_NOKKEL]: value });
  },
  async clear() {
    await chrome.storage.local.remove(LAGER_NOKKEL);
  },
};

/**
 * Administratorer kan peke klienten mot en annen lisensserver via
 * gruppepolicy — nødkanalen fra planens kapittel 7. Adressen må likevel
 * være dekket av host_permissions, så dette er for å bytte MELLOM de
 * forhåndsgodkjente adressene, ikke til en vilkårlig ny.
 */
async function baseUrls(): Promise<string[]> {
  try {
    const styrt = await chrome.storage.managed?.get("licenseBaseUrl");
    const overstyrt = styrt?.licenseBaseUrl;
    if (typeof overstyrt === "string" && overstyrt.startsWith("https://")) {
      return [overstyrt, ...BASE_URLS.filter((u) => u !== overstyrt)];
    }
  } catch {
    // Ingen policy satt, eller managed storage utilgjengelig — helt normalt.
  }
  return BASE_URLS;
}

let klientLovnad: Promise<LicenseClient> | null = null;

export function getLicenseClient(): Promise<LicenseClient> {
  klientLovnad ??= (async () =>
    new LicenseClient({
      baseUrls: await baseUrls(),
      trustedKeys: TRUSTED_KEYS,
      product: PRODUCT,
      version: chrome.runtime.getManifest().version,
      storage: chromeStorage,
    }))();
  return klientLovnad;
}

/**
 * Tilstanden caches kort. Hver melding fra et content script spør om
 * lisensen, og å verifisere en signatur på nytt for hvert tastetrykk ville
 * vært merkbart på en Celeron-maskin.
 */
let cache: { tid: number; state: LicenseState } | null = null;
const CACHE_MS = 15_000;

export async function licenseState(fersk = false): Promise<LicenseState> {
  if (!fersk && cache && Date.now() - cache.tid < CACHE_MS) return cache.state;
  const state = await (await getLicenseClient()).state();
  cache = { tid: Date.now(), state };
  return state;
}

export function invalidateLicenseCache(): void {
  cache = null;
}

export async function harFunksjon(navn: string): Promise<boolean> {
  return (await licenseState()).funksjoner.includes(navn);
}
