/**
 * Genererer et signeringsnøkkelsett for lisensserveren.
 * Kjør: pnpm exec tsx scripts/generate-signing-keys.mts [kid]
 *
 * Utskriften er JSON for miljøvariabelen SIGNING_KEYS_JWK hos Vercel.
 * Den PRIVATE delen skal aldri sjekkes inn eller lagres i databasen.
 * Klienten pinner bare den offentlige delen (skrives også ut separat).
 */
import { generateSigningKeys, exportPrivateJwks, exportPublicJwks } from "../packages/license-core/src/index.js";

const kid = process.argv[2] ?? `sk-${new Date().toISOString().slice(0, 7)}`;
const keys = await generateSigningKeys(kid);

console.log("=== SIGNING_KEYS_JWK (privat — til Vercel secrets, ALDRI i repo) ===");
console.log(JSON.stringify(await exportPrivateJwks(keys)));
console.log("\n=== Offentlig nøkkelsett (pinnes i klienten) ===");
console.log(JSON.stringify(await exportPublicJwks(keys), null, 2));
