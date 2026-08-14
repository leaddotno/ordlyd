/**
 * GET  /api/v1/admin/settings — les innstillingene
 * POST /api/v1/admin/settings — endre én eller flere
 *
 * Finnes for at prøvelengden og om fornyelse er tillatt skal kunne endres i
 * drift, uten ny utrulling og uten å måtte spørre en utvikler. Det er
 * avgjørelser som naturlig endrer seg når produktet møter virkeligheten.
 */

import { vercelHandler } from "../../../src/http.js";
import { getDb, ok, badRequest } from "../../../src/runtime.js";
import { requireAdmin } from "../../../src/admin-auth.js";
import { lesInnstillinger } from "../../../src/logic.js";

/** Bare disse kan endres, og bare til fornuftige verdier. */
const TILLATTE: Record<string, (v: unknown) => boolean> = {
  registrering_apen: (v) => typeof v === "boolean",
  prove_fornyelse_tillatt: (v) => typeof v === "boolean",
  prove_dager: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3650,
  prove_pool_id: (v) => typeof v === "string" && v.length > 0,
};

export default vercelHandler("POST", async (req) => {
  const denied = requireAdmin(req.headers);
  if (denied) return denied;

  // GET-lignende bruk: tom kropp betyr «bare les».
  const nøkler = Object.keys(req.body ?? {});
  if (nøkler.length === 0) {
    const db = getDb();
    return ok({ raa: await db.getSettings(), tolket: await lesInnstillinger(db) });
  }

  const ukjente = nøkler.filter((k) => !(k in TILLATTE));
  if (ukjente.length) return badRequest(`kan ikke endres: ${ukjente.join(", ")}`);

  const ugyldige = nøkler.filter((k) => !TILLATTE[k](req.body[k]));
  if (ugyldige.length) {
    return badRequest(
      `ugyldig verdi for: ${ugyldige.join(", ")} — prove_dager må være 1–3650, ` +
        "de andre må være true/false",
    );
  }

  const db = getDb();
  for (const k of nøkler) await db.setSetting(k, req.body[k]);
  await db.audit("superadmin", "endre-innstilling", { endret: nøkler });

  return ok({ raa: await db.getSettings(), tolket: await lesInnstillinger(db) });
});
