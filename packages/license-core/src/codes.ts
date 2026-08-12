/**
 * Lisenskoder: sju sifre, kryptografisk tilfeldige.
 *
 * Bare sifre er et bevisst valg for målgruppen (ingen b/d- eller
 * I/l-forveksling). Sikkerheten ligger ikke i kodelengden, men i
 * ratebegrensningen og pepperet — se planens P1.
 */

export const CODE_LENGTH = 7;
const CODE_SPACE = 10 ** CODE_LENGTH;

export function generateLicenseCode(): string {
  // Forkastingssampling for uniform fordeling over [0, 10^7)
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / CODE_SPACE) * CODE_SPACE;
  let n: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % CODE_SPACE).padStart(CODE_LENGTH, "0");
}

/** «1234567» → «123 4567» — slik koden vises og deles ut. */
export function formatLicenseCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Godtar mellomrom, bindestrek og punktum fra brukerens inntasting. */
export function normalizeLicenseCode(input: string): string {
  return input.replace(/[\s.\-–]/g, "");
}

export function isValidCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

/** Tilfeldig installasjonshemmelighet (256 bit, b64url). */
export function generateInstallSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
