/**
 * Økter for adminpanelet, og informasjonskapslene som bærer dem.
 *
 * Vi utsteder vår egen økt framfor å sende Supabase-tokens til
 * nettleseren. Gevinsten er at en rad vi eier kan rives i samme sekund
 * en tilgang trekkes tilbake — et JWT må vente til det utløper. Som
 * bieffekt slipper vi å betale for «session timeouts» og «single session
 * per user», som er Pro-funksjoner hos Supabase.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { bytesToB64url } from "@ordlyd/license-core";

/** Levetid på en vanlig økt. Fornyes glidende ved bruk. */
export const OKT_LEVETID_SEK = 12 * 60 * 60;
/** Absolutt tak uansett hvor aktiv man er. */
export const OKT_MAKS_ALDER_SEK = 7 * 24 * 60 * 60;
/** Nødinngangens økt — kort med vilje. */
export const NODOKT_LEVETID_SEK = 60 * 60;
/** Vinduet mellom passord og engangskode. */
export const TOTRINN_LEVETID_SEK = 10 * 60;

/**
 * `__Host-`-prefikset gjør at nettleseren nekter kapselen uten Secure og
 * Path=/, og uten Domain. Den kan derfor ikke settes for et helt domene
 * og lekker ikke til underdomener — og siden panelet ligger på
 * panel.ordlyd.no følger den aldri med på det utvidelsen sender til
 * lisens.ordlyd.no.
 */
export const OKT_KAPSEL = "__Host-ordlyd_panel";
/** Bærer det halvferdige innloggingssteget mellom passord og engangskode. */
export const TOTRINN_KAPSEL = "__Host-ordlyd_totrinn";

export function nyHemmelighet(): string {
  return bytesToB64url(new Uint8Array(randomBytes(32)));
}

/* ------------------------------------------------------------------ *
 * Informasjonskapsler
 * ------------------------------------------------------------------ */

export function settKapsel(navn: string, verdi: string, levetidSek: number): string {
  return [
    `${navn}=${verdi}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${levetidSek}`,
  ].join("; ");
}

export function slettKapsel(navn: string): string {
  return `${navn}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function lesKapsler(rå: string | string[] | undefined): Record<string, string> {
  const linje = Array.isArray(rå) ? rå.join("; ") : (rå ?? "");
  const ut: Record<string, string> = {};
  for (const del of linje.split(";")) {
    const i = del.indexOf("=");
    if (i < 1) continue;
    ut[del.slice(0, i).trim()] = del.slice(i + 1).trim();
  }
  return ut;
}

/* ------------------------------------------------------------------ *
 * Mellomsteget i totrinnsinnloggingen
 *
 * Mellom passord og engangskode må vi holde på Supabase-tokenet, som
 * trengs for å be om og bekrefte utfordringen. Det legges i en egen
 * kapsel med ti minutters levetid, KRYPTERT, slik at den ikke kan
 * brukes direkte mot Supabase om den skulle komme på avveie.
 *
 * Tokenet er uansett på nivå aal1, og vår egen tilgangskontroll gir
 * ingenting på aal1 — det eneste det duger til er å fullføre
 * totrinnssteget det ble laget for.
 * ------------------------------------------------------------------ */

/** 32-byte nøkkel avledet av pepperet, med eget domene. */
function kryptonokkel(pepper: string): Buffer {
  return createHash("sha256").update(`totrinn-kapsel:${pepper}`).digest();
}

export interface Mellomsteg {
  adminId: string;
  accessToken: string;
  faktorId: string;
  utfordringId: string;
  /** Unix-sekunder. Sjekkes i tillegg til kapselens egen levetid. */
  utloper: number;
}

export function forsegle(pepper: string, steg: Mellomsteg): string {
  const iv = randomBytes(12);
  const chiffer = createCipheriv("aes-256-gcm", kryptonokkel(pepper), iv);
  const kropp = Buffer.concat([
    chiffer.update(JSON.stringify(steg), "utf8"),
    chiffer.final(),
  ]);
  return [iv, chiffer.getAuthTag(), kropp]
    .map((b) => b.toString("base64url"))
    .join(".");
}

/** Returnerer null ved alt som ikke er en gyldig, uutløpt forsegling. */
export function aapne(pepper: string, forseglet: string, naaSek: number): Mellomsteg | null {
  try {
    const [ivB64, tagB64, kroppB64] = forseglet.split(".");
    if (!ivB64 || !tagB64 || !kroppB64) return null;
    const dechiffer = createDecipheriv(
      "aes-256-gcm",
      kryptonokkel(pepper),
      Buffer.from(ivB64, "base64url"),
    );
    dechiffer.setAuthTag(Buffer.from(tagB64, "base64url"));
    const klar = Buffer.concat([
      dechiffer.update(Buffer.from(kroppB64, "base64url")),
      dechiffer.final(),
    ]).toString("utf8");
    const steg = JSON.parse(klar) as Mellomsteg;
    if (typeof steg?.utloper !== "number" || steg.utloper < naaSek) return null;
    /*
     * faktorId er med vilje IKKE påkrevd her. Ved førstegangs oppsett
     * finnes det ingen faktor ennå — den lages i steget denne
     * forseglingen skal bære. Krevde vi den, ville den aller første
     * innloggingen på en ny konto vært umulig.
     */
    if (!steg.adminId || !steg.accessToken) return null;
    return steg;
  } catch {
    // Feil autentiseringsmerke, tuklet kapsel eller ugyldig JSON.
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Reservekoder
 * ------------------------------------------------------------------ */

export const ANTALL_RESERVEKODER = 10;

/**
 * Format: fire grupper à fire tegn, uten bokstaver som forveksles
 * (0/O, 1/I/l). De skal kunne skrives av for hånd på et ark og tastes
 * inn riktig et halvt år senere.
 */
const RESERVE_ALFABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function lagReservekoder(antall = ANTALL_RESERVEKODER): string[] {
  const koder: string[] = [];
  for (let i = 0; i < antall; i++) {
    const byte = randomBytes(16);
    let kode = "";
    for (let j = 0; j < 16; j++) {
      if (j > 0 && j % 4 === 0) kode += "-";
      kode += RESERVE_ALFABET[byte[j] % RESERVE_ALFABET.length];
    }
    koder.push(kode);
  }
  return koder;
}

/** Tåler små bokstaver, mellomrom og manglende bindestreker. */
export function normaliserReservekode(rå: string): string {
  const rent = rå.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return rent.match(/.{1,4}/g)?.join("-") ?? rent;
}
