/**
 * Lisenskonfigurasjon som pinnes inn i utvidelsen ved bygging.
 *
 * ┌─ VIKTIG ─────────────────────────────────────────────────────────────┐
 * │ BASE_URLS er frosset i manifestet. Manifest V3 lar utvidelsen bare   │
 * │ kontakte adresser den ba om tillatelse til ved bygging, så en        │
 * │ adresse som ikke står her kan vi IKKE bytte til i en krise uten en   │
 * │ ny butikkgodkjenning (opptil sju arbeidsdager).                      │
 * │                                                                      │
 * │ Når de tre domenene fra L0 er registrert, skal de legges inn her —   │
 * │ og i host_permissions i manifest.json — FØR første butikkutgivelse.  │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * TRUSTED_KEYS er tillitsankeret. Klienten stoler på kvitteringer som er
 * signert med disse nøklene, uansett hvilken server de kom fra. Derfor kan
 * serveren flytte fritt, og derfor kan en kapret DNS ikke lure klienten.
 *
 * Ved nøkkelrotasjon: legg den NYE nøkkelen til uten å fjerne den gamle,
 * rull ut, og fjern den gamle først når alle kvitteringer med den er
 * utløpt (100 dager). Fjerner du for tidlig, mister klienter lisensen.
 */

import type { PublicKeySet } from "@ordlyd/license-client";

export const PRODUCT = "edge-extension";

export const BASE_URLS = ["https://ordlyd-demo.vercel.app"];

export const TRUSTED_KEYS: PublicKeySet[] = [
  {
    kid: "sk-2026-08",
    ed25519: {
      key_ops: ["verify"],
      ext: true,
      alg: "Ed25519",
      crv: "Ed25519",
      x: "uQZe7-jKdKwoZvEJ7Y4Jqe7lsG1LgmMX4V6mXgvltqM",
      kty: "OKP",
    },
    p256: {
      key_ops: ["verify"],
      ext: true,
      kty: "EC",
      x: "wxMqWXM7M_XH4vGoSkcnGdxtmILiBciRTMkeVRY_7r0",
      y: "mlRkHZIppRNRMjkLKmX93fGEss9vS0CAy9jcJ5sIxjw",
      crv: "P-256",
    },
  },
];

/** Hvilken funksjon hver meldingstype krever. «ss-stop» står med vilje ikke her. */
export const FEATURE_FOR_MESSAGE: Record<string, string> = {
  "ss-speak": "tts",
  "ss-echo": "skriveekko",
  "ss-suggest": "prediksjon",
  "ss-check": "stavekontroll",
  "ss-dict": "ordbok",
};
