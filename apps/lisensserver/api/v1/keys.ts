/**
 * GET /api/v1/keys — offentlig nøkkelsett.
 *
 * Klientene PINNER nøklene sine ved bygging; dette endepunktet er for
 * verktøy, feilsøking og for å kunne bekrefte hvilken kid som er aktiv.
 * Ingen klient skal hente tillit herfra — da ville en falsk server kunne
 * levere sin egen nøkkel.
 */

import { vercelHandler } from "../../src/http.js";
import { getSigningKeys, ok } from "../../src/runtime.js";
import { exportPublicJwks } from "@ordlyd/license-core";

export default vercelHandler("GET", async () => {
  const jwks = await exportPublicJwks(await getSigningKeys());
  return {
    ...ok(jwks),
    headers: { "cache-control": "public, max-age=300" },
  };
});
