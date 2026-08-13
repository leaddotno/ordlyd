/**
 * Serverstyrt konfigurasjon som følger med hver kvittering: minsteversjon
 * per produkt, versjonsnummer på endepunktslisten, og tilbakekalte
 * nøkkel-id-er.
 *
 * Alt leses fra miljøvariabler, slik at en endring er en
 * miljøvariabel-oppdatering hos Vercel — ikke en ny utgivelse.
 */

import type { ServerConfig } from "./logic.js";

function parseJsonEnv<T>(name: string, fallback: T): T {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Feilskrevet konfigurasjon skal ikke ta ned lisensutstedelsen.
    console.error(`[lisensserver] ${name} er ikke gyldig JSON — bruker standardverdi`);
    return fallback;
  }
}

export function serverConfig(): ServerConfig {
  const minVersion = parseJsonEnv<Record<string, string>>("MIN_VERSIONS", {});
  const revoked = parseJsonEnv<string[]>("REVOKED_KIDS", []);
  const endpointsVer = Number(process.env.ENDPOINTS_VERSION ?? "");

  return {
    ...(Object.keys(minVersion).length ? { minVersion } : {}),
    ...(revoked.length ? { revoked } : {}),
    ...(Number.isFinite(endpointsVer) && endpointsVer > 0 ? { endpointsVer } : {}),
  };
}
