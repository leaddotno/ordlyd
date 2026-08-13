/**
 * POST /api/v1/admin/tenant — opprett kunde.
 * {slug, name, validTo?}  validTo er en dato «gyldig til og med».
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, newId, ok, badRequest } from "../../../src/runtime.js";
import { requireAdmin } from "../../../src/admin-auth.js";

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;

export default vercelHandler("POST", async (req) => {
  const denied = requireAdmin(req.headers);
  if (denied) return denied;

  const slug = requireString(req.body, "slug")?.toLowerCase();
  const name = requireString(req.body, "name");
  if (!slug || !SLUG.test(slug)) {
    return badRequest("slug må være små bokstaver, tall og bindestrek (2–49 tegn)");
  }
  if (!name) return badRequest("name er påkrevd");

  const validToRaw = requireString(req.body, "validTo");
  let validTo: number | null = null;
  if (validToRaw) {
    const ms = Date.parse(validToRaw);
    if (Number.isNaN(ms)) return badRequest("validTo må være en dato, f.eks. 2027-07-31");
    validTo = Math.floor(ms / 1000);
  }

  const db = getDb();
  const id = newId();
  try {
    await db.createTenant({ id, slug, name, status: "aktiv", validTo });
  } catch (err) {
    // Unik indeks på slug — gi et forståelig svar i stedet for 500.
    if (String(err).includes("duplicate key")) return badRequest(`kunden «${slug}» finnes allerede`);
    throw err;
  }
  await db.audit("superadmin", "opprett-kunde", { tenant: id, slug });
  return ok({ tenantId: id, slug, name });
});
