/**
 * Tynn klient mot Supabase Auth, kalt fra serversiden.
 *
 * Panelet snakker ALDRI direkte med Supabase. Alt går gjennom våre egne
 * endepunkter, av fire grunner (planens kapittel 02): ingen nøkkel
 * havner i nettleseren, innholdssikkerhetspolicyen slipper å åpne for et
 * fremmed domene, øktene kan rives fra vår egen tabell umiddelbart, og
 * reservekodene hører hjemme hos oss uansett siden Supabase ikke har dem.
 *
 * Skrevet med fetch framfor supabase-js, på samme måte som Resend-
 * klienten i epost.ts: to avhengigheter mindre å holde oppdatert i et
 * prosjekt som er nær ideelt drevet, og kallene er få og enkle.
 *
 * Supabase brukes her BARE som bekrefter av legitimasjon — passord og
 * TOTP. Selve økten er vår.
 */

import { requireEnv } from "./runtime.js";

/** Rollen som får opprette brukere og lese hvem som helst. Aldri til klient. */
const tjenestenokkel = (): string => requireEnv("SUPABASE_SERVICE_ROLE_KEY");
/** Den offentlige nøkkelen. Kreves som `apikey` på alle auth-kall. */
const apinokkel = (): string => requireEnv("SUPABASE_ANON_KEY");
const basis = (): string => requireEnv("SUPABASE_URL").replace(/\/$/, "");

export interface SupabaseFaktor {
  id: string;
  status: "verified" | "unverified";
  factor_type: string;
  friendly_name?: string;
}

export interface SupabaseBruker {
  id: string;
  email: string;
  factors?: SupabaseFaktor[];
}

export class AuthFeil extends Error {
  constructor(
    readonly status: number,
    readonly kode: string,
    melding: string,
  ) {
    super(melding);
  }
}

async function kall(
  sti: string,
  init: { metode?: string; kropp?: unknown; token?: string; tjeneste?: boolean } = {},
): Promise<any> {
  const headers: Record<string, string> = {
    apikey: apinokkel(),
    "content-type": "application/json",
  };
  if (init.tjeneste) headers.authorization = `Bearer ${tjenestenokkel()}`;
  else if (init.token) headers.authorization = `Bearer ${init.token}`;

  const res = await fetch(`${basis()}/auth/v1${sti}`, {
    method: init.metode ?? "GET",
    headers,
    ...(init.kropp === undefined ? {} : { body: JSON.stringify(init.kropp) }),
  });

  const tekst = await res.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!res.ok) {
    // Supabase svarer med ulike feltnavn avhengig av endepunkt.
    const kode = data?.error_code ?? data?.error ?? data?.code ?? String(res.status);
    const melding = data?.msg ?? data?.message ?? data?.error_description ?? "ukjent feil";
    throw new AuthFeil(res.status, String(kode), String(melding));
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Passord
 * ------------------------------------------------------------------ */

export interface Innlogging {
  accessToken: string;
  bruker: SupabaseBruker;
  /** Bekreftede TOTP-faktorer. Tom liste = totrinn er ikke satt opp ennå. */
  faktorer: SupabaseFaktor[];
}

/**
 * Bekrefter e-post og passord. Kaster AuthFeil ved feil legitimasjon.
 *
 * Merk at tokenet som kommer tilbake er på nivå aal1 selv om brukeren
 * har totrinn — Supabase skiller først etter at faktoren er bekreftet.
 * Vår egen tilgangskontroll krever aal2 for alt annet enn selve
 * totrinnssteget, så et aal1-token kan ikke brukes til noe hos oss.
 */
export async function loggInnMedPassord(epost: string, passord: string): Promise<Innlogging> {
  const svar = await kall("/token?grant_type=password", {
    metode: "POST",
    kropp: { email: epost, password: passord },
  });
  const bruker: SupabaseBruker = svar.user;
  const faktorer = (bruker.factors ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  return { accessToken: svar.access_token, bruker, faktorer };
}

/** Bytter passord på den innloggede brukeren. Krever et gyldig token. */
export async function settPassord(accessToken: string, nyttPassord: string): Promise<void> {
  await kall("/user", { metode: "PUT", token: accessToken, kropp: { password: nyttPassord } });
}

/* ------------------------------------------------------------------ *
 * Totrinn (TOTP)
 * ------------------------------------------------------------------ */

export interface Paamelding {
  faktorId: string;
  /** SVG som kan vises direkte i panelet. */
  qrKode: string;
  /** Hemmeligheten i tekst, for den som taster den inn manuelt. */
  hemmelighet: string;
}

export async function startTotp(accessToken: string, navn: string): Promise<Paamelding> {
  const svar = await kall("/factors", {
    metode: "POST",
    token: accessToken,
    kropp: { factor_type: "totp", friendly_name: navn },
  });
  return {
    faktorId: svar.id,
    qrKode: svar.totp?.qr_code ?? "",
    hemmelighet: svar.totp?.secret ?? "",
  };
}

/** Ber Supabase om en utfordring for faktoren. Returnerer utfordrings-id. */
export async function utfordreTotp(accessToken: string, faktorId: string): Promise<string> {
  const svar = await kall(`/factors/${faktorId}/challenge`, { metode: "POST", token: accessToken });
  return svar.id;
}

/**
 * Bekrefter engangskoden. Ved suksess returneres et nytt token på
 * nivå aal2. Kaster AuthFeil ved feil kode — Supabase ratebegrenser
 * disse forsøkene selv, i tillegg til vår egen telling.
 */
export async function bekreftTotp(
  accessToken: string,
  faktorId: string,
  utfordringId: string,
  kode: string,
): Promise<string> {
  const svar = await kall(`/factors/${faktorId}/verify`, {
    metode: "POST",
    token: accessToken,
    kropp: { challenge_id: utfordringId, code: kode },
  });
  return svar.access_token;
}

/* ------------------------------------------------------------------ *
 * Administrasjon — krever tjenestenøkkelen
 * ------------------------------------------------------------------ */

/**
 * Oppretter brukeren i Supabase Auth og returnerer id-en, som blir
 * primærnøkkel i vår egen admins-tabell.
 *
 * `email_confirm: true` fordi eieren oppretter kontoen manuelt for en
 * navngitt medarbeider — det er ikke selvbetjent registrering, og et
 * bekreftelsesledd ville bare vært en lenke til som kan gå tapt.
 */
export async function opprettBruker(epost: string, passord: string): Promise<string> {
  const svar = await kall("/admin/users", {
    metode: "POST",
    tjeneste: true,
    kropp: { email: epost, password: passord, email_confirm: true },
  });
  return svar.id;
}

export async function slettBruker(brukerId: string): Promise<void> {
  await kall(`/admin/users/${brukerId}`, { metode: "DELETE", tjeneste: true });
}

/** Setter nytt passord uten å kjenne det gamle. Brukes av eier ved tilbakestilling. */
export async function settPassordSomAdmin(brukerId: string, nyttPassord: string): Promise<void> {
  await kall(`/admin/users/${brukerId}`, {
    metode: "PUT",
    tjeneste: true,
    kropp: { password: nyttPassord },
  });
}

/** Fjerner alle TOTP-faktorer. Brukes når noen har mistet telefonen sin. */
export async function nullstillTotp(brukerId: string): Promise<number> {
  const bruker = await kall(`/admin/users/${brukerId}`, { tjeneste: true });
  const faktorer: SupabaseFaktor[] = bruker.factors ?? [];
  for (const f of faktorer) {
    await kall(`/admin/users/${brukerId}/factors/${f.id}`, { metode: "DELETE", tjeneste: true });
  }
  return faktorer.length;
}
