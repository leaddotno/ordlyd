/**
 * POST /api/v1/license/refresh — døgnlig bakgrunnsfornyelse.
 * Glidende utløp: hvert vellykket kall gir 100 nye dager.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, getPepper, getSigningKeys, nowSec, ok, badRequest } from "../../../src/runtime.js";
import { refresh } from "../../../src/logic.js";
import { serverConfig } from "../../../src/config.js";

export default vercelHandler("POST", async (req) => {
  const installId = requireString(req.body, "installId");
  const installSecret = requireString(req.body, "installSecret");
  const product = requireString(req.body, "product");
  if (!installId || !installSecret || !product) {
    return badRequest("installId, installSecret og product er påkrevd");
  }

  const result = await refresh(
    getDb(),
    getPepper(),
    await getSigningKeys(),
    {
      installId,
      installSecret,
      product,
      version: requireString(req.body, "version") ?? undefined,
      ip: req.ip,
      nowSec: nowSec(),
    },
    serverConfig(),
  );

  if (!result.ok) {
    // 403 forteller klienten «ikke prøv igjen med samme legitimasjon».
    // Klienten skal likevel BEHOLDE sin gamle kvittering til den utløper.
    return { status: 403, body: { feil: result.reason } };
  }
  return ok({ receipt: result.receipt });
});
