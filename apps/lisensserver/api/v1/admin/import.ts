/**
 * POST /api/v1/admin/import — importer e-postliste til en pool.
 *
 * Svaret inneholder klartekstkodene. Det er ENGANGS-EKSPORTEN som gis
 * videre til foreningen eller kommunen — serveren beholder bare hasher,
 * så listen kan aldri hentes ut på nytt.
 *
 * Midlertidig autentisering med delt hemmelighet. Erstattes av
 * passkey-innlogging når superadmin-panelet bygges (planens kapittel 4).
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, getPepper, newId, ok, badRequest, unauthorized, bearerToken, secretEquals, requireEnv } from "../../../src/runtime.js";
import { importEntries } from "../../../src/logic.js";

const MAX_EMAILS_PER_CALL = 5000;

export default vercelHandler("POST", async (req) => {
  const token = bearerToken(req.headers);
  if (!token || !secretEquals(token, requireEnv("ADMIN_TOKEN"))) return unauthorized();

  const poolId = requireString(req.body, "poolId");
  const emails = req.body.emails;
  if (!poolId) return badRequest("poolId er påkrevd");
  if (!Array.isArray(emails) || emails.length === 0) return badRequest("emails må være en ikke-tom liste");
  if (emails.length > MAX_EMAILS_PER_CALL) {
    return badRequest(`maks ${MAX_EMAILS_PER_CALL} adresser per kall — del opp listen`);
  }
  if (!emails.every((e) => typeof e === "string")) return badRequest("emails må inneholde bare tekst");

  const result = await importEntries(getDb(), getPepper(), poolId, emails as string[], newId);
  return ok({
    antallImportert: result.imported.length,
    antallHoppetOver: result.skipped.length,
    hoppetOver: result.skipped,
    // Eneste gang kodene finnes i klartekst. Lagre dem trygt nå.
    lisenser: result.imported,
  });
});
