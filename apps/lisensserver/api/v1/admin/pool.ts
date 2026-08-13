/**
 * POST /api/v1/admin/pool — opprett lisenspool under en kunde.
 * {tenantId, name, features[], products?, validTo?}
 *
 * Funksjonslisten kopieres inn i hver kvittering poolen utsteder, så det er
 * her man bestemmer hva brukerne faktisk får bruke.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, newId, ok, badRequest } from "../../../src/runtime.js";
import { requireAdmin } from "../../../src/admin-auth.js";

export const KJENTE_FUNKSJONER = ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"];
export const KJENTE_PRODUKTER = ["edge-extension", "win-desktop"];
export const KJENTE_PLANER = ["medlem", "skole", "prove", "apen"] as const;

export default vercelHandler("POST", async (req) => {
  const denied = requireAdmin(req.headers);
  if (denied) return denied;

  const tenantId = requireString(req.body, "tenantId");
  const name = requireString(req.body, "name");
  if (!tenantId || !name) return badRequest("tenantId og name er påkrevd");

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
  await db.audit("superadmin", "opprett-pool", { pool: id, tenant: tenantId, plan });
  return ok({ poolId: id, name, products, plan });
});
