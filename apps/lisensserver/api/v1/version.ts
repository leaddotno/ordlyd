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
 *   LATEST_VERSIONS  {"edge-extension":"1.0.1","win-desktop":"1.0.0"}
 *   MIN_VERSIONS     {"edge-extension":"1.0.0"}
 *   VERSION_NOTES    {"edge-extension":"Bedre uttale av forkortelser."}
 *
 * Nettleserbutikkene holdes i takt, så `chrome-extension` faller tilbake
 * på `edge-extension` når den ikke er oppgitt. Da slipper vi å vedlikeholde
 * to sett variabler for to pakker som alltid har samme versjon — og en
 * glemt Chrome-oppføring gir ikke «ukjent versjon» hos brukeren.
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

/** Nettleserpakkene har alltid samme versjon; Edge er kilden. */
const RESERVE: Record<string, string> = { "chrome-extension": "edge-extension" };

/** Butikken brukeren skal sendes til for å oppdatere manuelt. */
const BUTIKKSIDE: Record<string, string> = {
  "edge-extension":
    "https://microsoftedge.microsoft.com/addons/detail/ordlyd/" + (process.env.EDGE_ADDON_ID ?? ""),
  "chrome-extension":
    "https://chromewebstore.google.com/detail/" + (process.env.CHROME_ITEM_ID ?? ""),
};

export default vercelHandler("GET", async (req) => {
  const product = req.query.product ?? requireString(req.body, "product");
  if (!product) return badRequest("product er påkrevd");

  const slaaOpp = (navn: string): string | null => {
    const tabell = jsonEnv(navn);
    return tabell[product] ?? tabell[RESERVE[product] ?? ""] ?? null;
  };

  const butikkside = BUTIKKSIDE[product];

  return {
    ...ok({
      produkt: product,
      nyeste: slaaOpp("LATEST_VERSIONS"),
      minste: slaaOpp("MIN_VERSIONS"),
      merknad: slaaOpp("VERSION_NOTES"),
      // Tom hale betyr at butikk-id-en ikke er satt ennå; da er det
      // bedre å ikke sende noe enn å sende en halv lenke.
      butikkside: butikkside && !butikkside.endsWith("/") ? butikkside : null,
    }),
    // Kort caching: nok til å spare kall, kort nok til at en ny versjon
    // blir synlig raskt.
    headers: { "cache-control": "public, max-age=300" },
  };
});
