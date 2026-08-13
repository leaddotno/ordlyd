/**
 * Kjøretidshjelpere for Vercel-funksjonene: miljøvariabler, delte
 * singletons og HTTP-svar.
 *
 * Hemmeligheter (pepper, private signeringsnøkler) leses kun herfra og
 * havner aldri i svar, logg eller database.
 */

import { timingSafeEqual } from "node:crypto";
import { importSigningKeys, type SigningKeyPair, type PrivateJwks } from "@ordlyd/license-core";
import { createSql, PostgresDb, type Sql } from "./db-postgres.js";
import type { Db } from "./types.js";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Mangler miljøvariabel ${name}`);
  return value;
}

/**
 * Gjenbrukes mellom kall i samme funksjonsinstans — å opprette
 * tilkobling og importere nøkler per forespørsel ville lagt hundrevis
 * av millisekunder på hver fornyelse.
 */
let sqlSingleton: Sql | undefined;
let keysSingleton: Promise<SigningKeyPair> | undefined;

export function getDb(): Db {
  sqlSingleton ??= createSql(requireEnv("DATABASE_URL"));
  return new PostgresDb(sqlSingleton);
}

export function getSigningKeys(): Promise<SigningKeyPair> {
  keysSingleton ??= (async () => {
    const jwks = JSON.parse(requireEnv("SIGNING_KEYS_JWK")) as PrivateJwks;
    return importSigningKeys(jwks);
  })();
  return keysSingleton;
}

export function getPepper(): string {
  return requireEnv("LICENSE_PEPPER");
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Første ledd i x-forwarded-for er klientens adresse hos Vercel. */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["x-forwarded-for"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.split(",")[0]?.trim() || "0.0.0.0";
}

/**
 * Sammenligner uten å lekke informasjon gjennom tidsbruk. Brukes på
 * admin- og cron-hemmeligheter.
 */
export function secretEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function bearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7);
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * CORS: utvidelsen kaller fra en chrome-extension://-opprinnelse som
 * endrer seg mellom utviklings- og butikkbygg, så vi åpner for alle.
 * Det er trygt her fordi autentisering skjer i kroppen eller en
 * Authorization-header — aldri via informasjonskapsler — så en fremmed
 * nettside kan ikke låne en innlogget brukers tilgang.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

export const ok = (body: unknown): HttpResponse => ({ status: 200, body });
export const badRequest = (feil: string): HttpResponse => ({ status: 400, body: { feil } });
export const unauthorized = (): HttpResponse => ({ status: 401, body: { feil: "ikke-autorisert" } });
export const tooManyRequests = (): HttpResponse => ({
  status: 429,
  body: { feil: "for-mange-forsok" },
  headers: { "retry-after": "900" },
});
