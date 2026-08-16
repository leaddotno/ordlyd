/**
 * POST /api/v1/admin/pool — opprett lisenspool under en kunde.
 * {tenantId, name, features[], products?, validTo?, plan?}
 *
 * Funksjonslisten kopieres inn i hver kvittering poolen utsteder, så det er
 * her man bestemmer hva brukerne faktisk får bruke.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, newId, ok, badRequest } from "../../../src/runtime.js";
import { loesInnlogget, erNektet, krevPanelhode, somAktor } from "../../../src/admin-auth.js";
import { krevEndring, krevKunde } from "../../../src/tilgang.js";

export const KJENTE_FUNKSJONER = ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"];
export const KJENTE_PRODUKTER = ["edge-extension", "win-desktop"];
export const KJENTE_PLANER = ["medlem", "skole", "prove", "apen"] as const;

export default vercelHandler("POST", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;
  const vakt = krevPanelhode(req, meg) ?? krevEndring(meg);
  if (vakt) return vakt;

  const tenantId = requireString(req.body, "tenantId");
  const name = requireString(req.body, "name");
  if (!tenantId || !name) return badRequest("tenantId og name er påkrevd");

  // Avgrensningen sjekkes FØR kunden slås opp, slik at en fremmed
  // kunde-id ikke kan skilles fra en som ikke finnes.
  const utenfor = krevKunde(meg, tenantId);
  if (utenfor) return utenfor;

  const features = Array.isArray(req.body.features) ? (req.body.features as unknown[]) : [];
  const ukjent = features.filter((f) => typeof f !== "string" || !KJENTE_FUNKSJONER.includes(f));
  if (features.length === 0) return badRequest(`velg minst én funksjon: ${KJENTE_FUNKSJONER.join(", ")}`);
  if (ukjent.length) return badRequest(`ukjent(e) funksjon(er): ${ukjent.join(", ")}`);

  const valgteProdukter = Array.isArray(req.body.products) ? (req.body.products as unknown[]) : ["edge-extension"];
  const ukjentProdukt = valgteProdukter.filter((p) => typeof p !== "string" || !KJENTE_PRODUKTER.includes(p));
  if (ukjentProdukt.length) return badRequest(`ukjent(e) produkt(er): ${ukjentProdukt.join(", ")}`);

  const validToRaw = requireString(req.body, "validTo");
  let validTo: number | null = null;
  if (validToRaw) {
    const ms = Date.parse(validToRaw);
    if (Number.isNaN(ms)) return badRequest("validTo må være en dato, f.eks. 2027-07-31");
    validTo = Math.floor(ms / 1000);
  }

  const plan = (requireString(req.body, "plan") ?? "apen") as (typeof KJENTE_PLANER)[number];
  if (!KJENTE_PLANER.includes(plan)) {
    return badRequest(`ukjent lisenstype «${plan}» — velg blant ${KJENTE_PLANER.join(", ")}`);
  }

  const db = getDb();
  const tenant = await db.getTenant(tenantId);
  if (!tenant) return badRequest("ukjent kunde");

  const products: Record<string, { features: string[] }> = {};
  for (const p of valgteProdukter as string[]) products[p] = { features: features as string[] };

  const id = newId();
  await db.createPool({ id, tenantId, name, status: "aktiv", validTo, products, plan });

  const a = somAktor(meg);
  await db.audit(a.actor, "opprett-pool", { pool: id, tenant: tenantId, plan }, {
    actorId: a.actorId,
    actorKind: a.actorKind,
    tenantId,
  });
  return ok({ poolId: id, name, products, plan });
}, { cors: false });
