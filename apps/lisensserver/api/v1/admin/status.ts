/**
 * POST /api/v1/admin/status — steng eller gjenåpne en lisens.
 * {entryId, status: "aktiv" | "stengt", reason?}
 *
 * Stenging håndheves ved neste fornyelse: klienten mister ikke tilgangen
 * øyeblikkelig, men får ingen ny kvittering og går i degradert modus når
 * den gjeldende løper ut. Det er den bevisste avveiningen i planen — ingen
 * elev mister opplesingen midt i en time.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, ok, badRequest } from "../../../src/runtime.js";
import { requireAdmin } from "../../../src/admin-auth.js";

export default vercelHandler("POST", async (req) => {
  const denied = requireAdmin(req.headers);
  if (denied) return denied;

  const entryId = requireString(req.body, "entryId");
  const status = requireString(req.body, "status");
  if (!entryId) return badRequest("entryId er påkrevd");
  if (status !== "aktiv" && status !== "stengt") return badRequest("status må være «aktiv» eller «stengt»");

  const db = getDb();
  const entry = await db.getEntry(entryId);
  if (!entry) return badRequest("ukjent lisens");

  await db.setEntryStatus(entryId, status);
  await db.audit("superadmin", status === "stengt" ? "steng" : "gjenaapne", {
    entry: entryId,
    grunn: requireString(req.body, "reason") ?? "ikke oppgitt",
  });
  return ok({ entryId, status, maskertEpost: entry.emailMasked });
});
