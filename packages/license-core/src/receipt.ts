/**
 * Lisenskvitteringen — et lite signert dokument klienten verifiserer
 * lokalt, uten nettverk.
 *
 * Konvoluttformat (PASETO-disiplin: faste primitiver, ingen forhandling):
 *
 *   SSLIC1.<payload b64url>.<Ed25519-signatur b64url>.<P-256-signatur b64url>
 *
 * Begge signaturene dekker NØYAKTIG de samme bytene: UTF-8 av
 * "SSLIC1." + payload-b64url-strengen. Vi signerer den serialiserte
 * strengen — aldri et re-serialisert JSON-objekt — så ingen
 * kanonikaliseringsfeller finnes.
 */

import { bytesToB64url, b64urlToBytes, utf8, fromUtf8 } from "./encoding.js";
import type { SigningKeyPair, VerifyKeys } from "./keys.js";

const subtle = globalThis.crypto.subtle;

export const ENVELOPE_PREFIX = "SSLIC1";

/** Levetider i sekunder — fra planens kapittel 5. */
export const RECEIPT_TTL_SEC = 100 * 24 * 3600;
export const RECEIPT_SOFT_TTL_SEC = 70 * 24 * 3600;

export interface ReceiptPayload {
  v: 1;
  kid: string;
  iss: string;
  /** Utsteder-kvalifisert subjekt: "code:<e-posthash>", senere "feide:…" */
  sub: string;
  tenant: string;
  install: string;
  products: Record<string, { features: string[] }>;
  iat: number;
  softExp: number;
  exp: number;
  serverTime: number;
  minVersion?: Record<string, string>;
  endpointsVer?: number;
  revoked?: string[];
}

export type ReceiptState = "aktiv" | "varsel" | "utlopt";

export interface VerifyResult {
  ok: boolean;
  payload?: ReceiptPayload;
  via?: "ed25519" | "p256";
  state?: ReceiptState;
  reason?: string;
}

function signedBytes(payloadB64: string): Uint8Array {
  return utf8(`${ENVELOPE_PREFIX}.${payloadB64}`);
}

export async function signReceipt(
  payload: ReceiptPayload,
  keys: SigningKeyPair,
): Promise<string> {
  if (payload.kid !== keys.kid) {
    throw new Error(`payload.kid (${payload.kid}) matcher ikke nøkkelens kid (${keys.kid})`);
  }
  const payloadB64 = bytesToB64url(utf8(JSON.stringify(payload)));
  const bytes = signedBytes(payloadB64);
  const sigEd = new Uint8Array(
    await subtle.sign({ name: "Ed25519" }, keys.ed25519.privateKey, bytes as BufferSource),
  );
  const sigP256 = new Uint8Array(
    await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.p256.privateKey,
      bytes as BufferSource,
    ),
  );
  return `${ENVELOPE_PREFIX}.${payloadB64}.${bytesToB64url(sigEd)}.${bytesToB64url(sigP256)}`;
}

/**
 * Verifiserer konvolutten mot pinnede offentlige nøkler og vurderer
 * tilstanden mot klokka. Prøver Ed25519 først, faller tilbake til P-256
 * (dekker .NET og eldre Edge). ÉN gyldig signatur holder — begge dekker
 * samme bytes fra samme utsteder.
 */
export async function verifyReceipt(
  envelope: string,
  trustedKeys: VerifyKeys[],
  nowSec: number,
): Promise<VerifyResult> {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) {
    return { ok: false, reason: "ukjent format" };
  }
  const [, payloadB64, sigEdB64, sigP256B64] = parts;

  let payload: ReceiptPayload;
  try {
    payload = JSON.parse(fromUtf8(b64urlToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: "uleselig innhold" };
  }
  if (payload.v !== 1) return { ok: false, reason: `ukjent versjon ${payload.v}` };

  const keys = trustedKeys.find((k) => k.kid === payload.kid);
  if (!keys) return { ok: false, reason: `ukjent nøkkel-id ${payload.kid}` };

  const bytes = signedBytes(payloadB64);
  let via: "ed25519" | "p256" | undefined;

  if (keys.ed25519) {
    try {
      const valid = await subtle.verify(
        { name: "Ed25519" },
        keys.ed25519,
        b64urlToBytes(sigEdB64) as BufferSource,
        bytes as BufferSource,
      );
      if (valid) via = "ed25519";
    } catch {
      /* faller videre til P-256 */
    }
  }
  if (!via && keys.p256) {
    try {
      const valid = await subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keys.p256,
        b64urlToBytes(sigP256B64) as BufferSource,
        bytes as BufferSource,
      );
      if (valid) via = "p256";
    } catch {
      /* ugyldig signaturformat behandles som ugyldig signatur */
    }
  }
  if (!via) return { ok: false, reason: "ugyldig signatur" };

  const state: ReceiptState =
    nowSec >= payload.exp ? "utlopt" : nowSec >= payload.softExp ? "varsel" : "aktiv";
  return { ok: true, payload, via, state };
}
