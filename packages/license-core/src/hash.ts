/**
 * Pepret hashing av e-post, lisenskoder og nettnøkler.
 *
 * Pepperet er en hemmelig 256-bits nøkkel som bor i Vercels secret-lager
 * og ALDRI i databasen. Uten det er hashene verdiløse for en angriper —
 * som er nødvendig fordi både e-poster og sjusifrede koder har lav
 * entropi og ville latt seg brute-force fra en lekket tabell.
 *
 * Domeneprefikser (email:/code:/net:/secret:) hindrer at en hash fra ett
 * felt kan gjenbrukes i et annet.
 */

import { bytesToB64url, utf8 } from "./encoding.js";

const subtle = globalThis.crypto.subtle;

async function hmac(pepper: string, message: string): Promise<string> {
  const key = await subtle.importKey(
    "raw",
    utf8(pepper) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, utf8(message) as BufferSource);
  return bytesToB64url(new Uint8Array(sig));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashEmail(pepper: string, email: string): Promise<string> {
  return hmac(pepper, `email:${normalizeEmail(email)}`);
}

/** Koden bindes til e-posten — samme kode hos en annen bruker gir en annen hash. */
export async function hashCode(pepper: string, email: string, code: string): Promise<string> {
  return hmac(pepper, `code:${normalizeEmail(email)}:${code}`);
}

export async function hashInstallSecret(pepper: string, secret: string): Promise<string> {
  return hmac(pepper, `secret:${secret}`);
}

/**
 * Hemmeligheter på adminsiden: øktnøkler, reservekoder og maskintokens.
 *
 * Egne domeneprefikser av samme grunn som over — en øktnøkkel skal ikke
 * kunne gjenbrukes som reservekode om noen skulle klare å regne ut den
 * ene. Disse har høy entropi (32 tilfeldige byte), i motsetning til
 * e-poster og sjusifrede koder, men pepres likevel: da er en lekket
 * admin_sessions-tabell verdiløs uten nøkkelen fra Vercel.
 */
export type AdminHemmelighet = "okt" | "recovery" | "apitoken";

export async function hashAdminSecret(
  pepper: string,
  domain: AdminHemmelighet,
  value: string,
): Promise<string> {
  return hmac(pepper, `${domain}:${value}`);
}

/**
 * Pseudonymisert nettnøkkel for misbrukstellerne: /24 for IPv4, /48 for
 * IPv6. Rå IP lagres aldri — bare denne hashen, og bare som del av et
 * aggregert døgntall.
 */
export async function hashNet(pepper: string, ip: string): Promise<string> {
  const prefix = ip.includes(":")
    ? ip.split(":").slice(0, 3).join(":")
    : ip.split(".").slice(0, 3).join(".");
  return hmac(pepper, `net:${prefix}`);
}

/** Maskert visningsvariant for adminpanelet: "jk@telemarkfylke.no" → "j***@telemarkfylke.no" */
export function maskEmail(email: string): string {
  const [local, domain] = normalizeEmail(email).split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}
