/**
 * POST /api/v1/admin/tenant — opprett kunde.
 * {slug, name, validTo?}  validTo er en dato «gyldig til og med».
 *
 * Krever eier eller forvalter: en kundeadmin styrer sine egne kunder,
 * men oppretter ikke nye.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, newId, ok, badRequest } from "../../../src/runtime.js";
import { loesInnlogget, erNektet, krevPanelhode, somAktor } from "../../../src/admin-auth.js";
import { krevEndring, krevKundeoppretting } from "../../../src/tilgang.js";

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;

export default vercelHandler("POST", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;
  const vakt = krevPanelhode(req, meg) ?? krevEndring(meg) ?? krevKundeoppretting(meg);
  if (vakt) return vakt;

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

  const a = somAktor(meg);
  await db.audit(a.actor, "opprett-kunde", { tenant: id, slug }, {
    actorId: a.actorId,
    actorKind: a.actorKind,
    tenantId: id,
  });
  return ok({ tenantId: id, slug, name });
}, { cors: false });
