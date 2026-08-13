/**
 * POST /api/v1/login — eleven logger inn med e-post + lisenskode.
 * Skjer én gang per maskin; deretter fornyer klienten seg selv med
 * installasjonshemmeligheten den får her.
 */

import { vercelHandler, requireString } from "../../src/http.js";
import { getDb, getPepper, getSigningKeys, newId, nowSec, ok, badRequest, tooManyRequests } from "../../src/runtime.js";
import { login } from "../../src/logic.js";
import { serverConfig } from "../../src/config.js";

export default vercelHandler("POST", async (req) => {
  const email = requireString(req.body, "email");
  const code = requireString(req.body, "code");
  const product = requireString(req.body, "product");
  if (!email || !code || !product) return badRequest("email, code og product er påkrevd");

  const result = await login(
    getDb(),
    getPepper(),
    await getSigningKeys(),
    {
      email,
      code,
      product,
      version: requireString(req.body, "version") ?? undefined,
      ip: req.ip,
      nowSec: nowSec(),
    },
    newId,
    serverConfig(),
  );

  if (!result.ok) {
    if (result.reason === "for-mange-forsok") return tooManyRequests();
    // Samme svar for feil kode og stengt konto, slik at endepunktet ikke
    // kan brukes til å kartlegge hvilke e-poster som finnes.
    return { status: 401, body: { feil: result.reason === "utenfor-periode" ? "utenfor-periode" : "avvist" } };
  }
  return ok({
    receipt: result.receipt,
    installId: result.installId,
    installSecret: result.installSecret,
  });
});
