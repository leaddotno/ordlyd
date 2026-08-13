/**
 * GET /api/health — bekrefter at deployen lever, at databasen svarer og
 * at signeringsnøklene lastes. Lekker ingen hemmeligheter: bare nøkkel-id.
 */

import { vercelHandler } from "../src/http.js";
import { getDb, getSigningKeys, ok, nowSec } from "../src/runtime.js";

export default vercelHandler("GET", async () => {
  const checks: Record<string, string> = {};

  try {
    await getDb().getTenant("00000000-0000-0000-0000-000000000000");
    checks.database = "ok";
  } catch (err) {
    checks.database = `feil: ${(err as Error).message}`;
  }

  try {
    checks.signingKey = (await getSigningKeys()).kid;
  } catch (err) {
    checks.signingKey = `feil: ${(err as Error).message}`;
  }

  checks.pepper = process.env.LICENSE_PEPPER ? "satt" : "MANGLER";

  const healthy = checks.database === "ok" && !checks.signingKey.startsWith("feil") && checks.pepper === "satt";
  return { ...ok({ ok: healthy, tid: nowSec(), sjekker: checks }), status: healthy ? 200 : 503 };
});
