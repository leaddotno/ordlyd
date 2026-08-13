/**
 * POST /api/v1/admin/close — steng en lisens som misbrukes.
 *
 * Håndhevingen skjer ved neste fornyelse: klienten mister ikke tilgangen
 * øyeblikkelig, men får ingen ny kvittering, og går i degradert modus når
 * den gjeldende løper ut. Det er den bevisste avveiningen i planen —
 * ingen elev mister opplesingen midt i en time.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, ok, badRequest, unauthorized, bearerToken, secretEquals, requireEnv } from "../../../src/runtime.js";
import { closeEntry } from "../../../src/logic.js";

export default vercelHandler("POST", async (req) => {
  const token = bearerToken(req.headers);
  if (!token || !secretEquals(token, requireEnv("ADMIN_TOKEN"))) return unauthorized();

  const entryId = requireString(req.body, "entryId");
  if (!entryId) return badRequest("entryId er påkrevd");

  const db = getDb();
  const entry = await db.getEntry(entryId);
  if (!entry) return badRequest("ukjent lisens");

  await closeEntry(db, entryId, requireString(req.body, "reason") ?? "ikke oppgitt");
  return ok({ stengt: entryId, maskertEpost: entry.emailMasked });
});
