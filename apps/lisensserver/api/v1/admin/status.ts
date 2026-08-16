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
import { getDb, getSql, ok, badRequest } from "../../../src/runtime.js";
import { loesInnlogget, erNektet, krevPanelhode, somAktor } from "../../../src/admin-auth.js";
import { krevEndring, krevKunde } from "../../../src/tilgang.js";
import { poolensKunde } from "../../../src/admin-queries.js";

export default vercelHandler("POST", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;
  const vakt = krevPanelhode(req, meg) ?? krevEndring(meg);
  if (vakt) return vakt;

  const entryId = requireString(req.body, "entryId");
  const status = requireString(req.body, "status");
  if (!entryId) return badRequest("entryId er påkrevd");
  if (status !== "aktiv" && status !== "stengt") return badRequest("status må være «aktiv» eller «stengt»");

  const db = getDb();
  const entry = await db.getEntry(entryId);
  if (!entry) return badRequest("ukjent lisens");

  // Lisensen tilhører en pool, som tilhører en kunde. En kundeadmin får
  // nøyaktig samme svar for en fremmed lisens som for en som ikke finnes.
  const kunde = await poolensKunde(getSql(), entry.poolId);
  if (!kunde || krevKunde(meg, kunde)) return badRequest("ukjent lisens");

  await db.setEntryStatus(entryId, status);
  const a = somAktor(meg);
  await db.audit(a.actor, status === "stengt" ? "steng" : "gjenaapne", {
    entry: entryId,
    grunn: requireString(req.body, "reason") ?? "ikke oppgitt",
  }, {
    actorId: a.actorId,
    actorKind: a.actorKind,
    tenantId: kunde,
  });
  return ok({ entryId, status, maskertEpost: entry.emailMasked });
}, { cors: false });
