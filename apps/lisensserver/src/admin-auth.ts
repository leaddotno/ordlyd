/**
 * Delt tilgangssjekk for admin-endepunktene.
 *
 * Midlertidig løsning med delt hemmelighet (ADMIN_TOKEN). Erstattes av
 * passkey-innlogging — se planens kapittel 4. Den dagen byttes bare denne
 * funksjonen ut; endepunktene under er uendret.
 */

import { bearerToken, secretEquals, requireEnv, unauthorized, type HttpResponse } from "./runtime.js";

/** Returnerer null når forespørselen er godkjent, ellers svaret som skal sendes. */
export function requireAdmin(headers: Record<string, string | string[] | undefined>): HttpResponse | null {
  const token = bearerToken(headers);
  if (!token || !secretEquals(token, requireEnv("ADMIN_TOKEN"))) return unauthorized();
  return null;
}
