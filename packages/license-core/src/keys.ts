/**
 * Nøkkelpar for kvitteringssignering.
 *
 * Hver kvittering signeres to ganger over samme bytes:
 *  - Ed25519 (foretrukket; WebCrypto i Chromium 137+)
 *  - ECDSA P-256 (innebygd i både WebCrypto og .NET — PC-appen slipper
 *    tredjeparts kryptobibliotek siden .NET mangler Ed25519 før .NET 11)
 *
 * Verifikatoren HARDPINNER algoritmene: ingen alg-felt leses fra
 * dokumentet, så JWT-klassikerne (alg:none, algoritmeforvirring) er
 * umulige ved konstruksjon.
 */

const subtle = globalThis.crypto.subtle;

export interface SigningKeyPair {
  kid: string;
  ed25519: CryptoKeyPair;
  p256: CryptoKeyPair;
}

export interface VerifyKeys {
  kid: string;
  ed25519?: CryptoKey;
  p256?: CryptoKey;
}

export interface PublicJwks {
  kid: string;
  ed25519: JsonWebKey;
  p256: JsonWebKey;
}

export interface PrivateJwks extends PublicJwks {
  ed25519Private: JsonWebKey;
  p256Private: JsonWebKey;
}

export async function generateSigningKeys(kid: string): Promise<SigningKeyPair> {
  const ed25519 = (await subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const p256 = (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return { kid, ed25519, p256 };
}

export async function exportPublicJwks(keys: SigningKeyPair): Promise<PublicJwks> {
  return {
    kid: keys.kid,
    ed25519: await subtle.exportKey("jwk", keys.ed25519.publicKey),
    p256: await subtle.exportKey("jwk", keys.p256.publicKey),
  };
}

export async function exportPrivateJwks(keys: SigningKeyPair): Promise<PrivateJwks> {
  return {
    ...(await exportPublicJwks(keys)),
    ed25519Private: await subtle.exportKey("jwk", keys.ed25519.privateKey),
    p256Private: await subtle.exportKey("jwk", keys.p256.privateKey),
  };
}

export async function importSigningKeys(jwks: PrivateJwks): Promise<SigningKeyPair> {
  return {
    kid: jwks.kid,
    ed25519: {
      publicKey: await subtle.importKey("jwk", jwks.ed25519, { name: "Ed25519" }, true, ["verify"]),
      privateKey: await subtle.importKey("jwk", jwks.ed25519Private, { name: "Ed25519" }, true, ["sign"]),
    },
    p256: {
      publicKey: await subtle.importKey("jwk", jwks.p256, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]),
      privateKey: await subtle.importKey("jwk", jwks.p256Private, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]),
    },
  };
}

/**
 * Importerer offentlige nøkler for verifisering. Tåler at én av kurvene
 * mangler — PC-appen kommer bare til å pinne P-256, utvidelsen begge.
 */
export async function importVerifyKeys(jwks: {
  kid: string;
  ed25519?: JsonWebKey;
  p256?: JsonWebKey;
}): Promise<VerifyKeys> {
  const out: VerifyKeys = { kid: jwks.kid };
  if (jwks.ed25519) {
    out.ed25519 = await subtle.importKey("jwk", jwks.ed25519, { name: "Ed25519" }, false, ["verify"]);
  }
  if (jwks.p256) {
    out.p256 = await subtle.importKey("jwk", jwks.p256, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  return out;
}
