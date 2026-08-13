/**
 * GET /api/v1/version?product=edge-extension
 *
 * Hva som er nyeste tilgjengelige versjon, til «Om Ordlyd». Åpent
 * endepunkt: det finnes ingen hemmelighet i et versjonsnummer, og en
 * bruker uten gyldig lisens skal fortsatt kunne se om hun har gammel
 * programvare.
 *
 * Verdiene leses fra miljøvariabler, så en ny versjon kunngjøres ved å
 * endre en variabel hos Vercel — ingen ny utrulling av serveren.
 *
 *   LATEST_VERSIONS  {"edge-extension":"0.0.2","win-desktop":"1.0.0"}
 *   MIN_VERSIONS     {"edge-extension":"0.0.1"}
 *   VERSION_NOTES    {"edge-extension":"Bedre uttale av forkortelser."}
 */

import { vercelHandler, requireString } from "../../src/http.js";
import { ok, badRequest } from "../../src/runtime.js";

function jsonEnv(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.error(`[lisensserver] ${name} er ikke gyldig JSON`);
    return {};
  }
}

export default vercelHandler("GET", async (req) => {
  const product = req.query.product ?? requireString(req.body, "product");
  if (!product) return badRequest("product er påkrevd");

  return {
    ...ok({
      produkt: product,
      nyeste: jsonEnv("LATEST_VERSIONS")[product] ?? null,
      minste: jsonEnv("MIN_VERSIONS")[product] ?? null,
      merknad: jsonEnv("VERSION_NOTES")[product] ?? null,
    }),
    // Kort caching: nok til å spare kall, kort nok til at en ny versjon
    // blir synlig raskt.
    headers: { "cache-control": "public, max-age=300" },
  };
});
