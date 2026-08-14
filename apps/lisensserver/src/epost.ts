/**
 * E-postutsending via Resend.
 *
 * ┌─ PERSONVERN ─────────────────────────────────────────────────────────┐
 * │ Resend er amerikansk (Plus Five Five, Inc.) og lagrer e-postdata i   │
 * │ USA i 30 dager — også når sendingsregionen er Irland. Alt som sendes │
 * │ herfra havner altså hos en amerikansk databehandler. Send derfor     │
 * │ ALDRI mer enn det som må til: adressen, lisenskoden og hva brukeren  │
 * │ trenger for å komme i gang. Ingen navn, ingen bruksdata, ingen tekst │
 * │ fra brukerens dokumenter.                                            │
 * │ Resend står som underdatabehandler i personvernerklæringen.          │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { formatLicenseCode } from "@ordlyd/license-core";

const RESEND_URL = "https://api.resend.com/emails";
export const AVSENDER = "Ordlyd <post@hjelp.ordlyd.no>";

export type SendResultat =
  | { ok: true; id: string }
  | { ok: false; grunn: "kvote-brukt-opp" | "ratebegrenset" | "avvist" | "nettverksfeil"; detalj: string };

/**
 * Sender én e-post.
 *
 * `idempotencyKey` er ikke pynt: endepunktet vårt kan bli forsøkt på nytt
 * (Vercel-timeout, brukeren dobbelklikker), og uten nøkkelen ville samme
 * velkomst-e-post gått ut flere ganger. Resend holder nøkkelen i 24 timer.
 */
export async function sendEpost(opts: {
  apiKey: string;
  til: string;
  emne: string;
  html: string;
  tekst: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<SendResultat> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await f(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": opts.idempotencyKey,
      },
      body: JSON.stringify({
        from: AVSENDER,
        to: opts.til,
        subject: opts.emne,
        html: opts.html,
        text: opts.tekst,
      }),
    });
  } catch (err) {
    return { ok: false, grunn: "nettverksfeil", detalj: String(err) };
  }

  if (res.ok) {
    const j = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: j?.id ?? "ukjent" };
  }

  const kropp = await res.text().catch(() => "");
  // 429 dekker to helt ulike ting: for mange kall per sekund (prøv igjen
  // straks) og oppbrukt døgn-/månedskvote (prøv igjen er nytteløst).
  if (res.status === 429) {
    const kvote = /quota/i.test(kropp);
    return {
      ok: false,
      grunn: kvote ? "kvote-brukt-opp" : "ratebegrenset",
      detalj: kropp.slice(0, 300),
    };
  }
  return { ok: false, grunn: "avvist", detalj: `${res.status} ${kropp.slice(0, 300)}` };
}

const norskDato = (sek: number): string =>
  new Date(sek * 1000).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });

/**
 * Velkomst-e-posten.
 *
 * Skrevet for målgruppen: korte setninger, koden stor og med luft mellom
 * sifrene, og bare én ting å gjøre. HTML-en bruker tabeller og innebygde
 * stiler fordi e-postklienter ikke er nettlesere — Outlook ignorerer det
 * meste av moderne CSS.
 */
export function velkomstEpost(opts: {
  kode: string;
  validTo: number | null;
  slag: "ny" | "fornyet" | "gjenopprettet";
  pool?: string;
}): { emne: string; html: string; tekst: string } {
  const kode = formatLicenseCode(opts.kode);
  const gyldighet = opts.validTo
    ? `Lisensen gjelder til ${norskDato(opts.validTo)}.`
    : "Lisensen er løpende og har ingen sluttdato.";

  const emne =
    opts.slag === "gjenopprettet"
      ? "Ny lisenskode til Ordlyd"
      : opts.slag === "fornyet"
        ? "Ordlyd-lisensen din er fornyet"
        : "Velkommen til Ordlyd — her er lisenskoden din";

  const innledning =
    opts.slag === "gjenopprettet"
      ? `Her er en ny lisenskode til Ordlyd. Den gamle koden slutter å virke.${
          opts.pool ? ` Lisensen din er registrert hos ${opts.pool}.` : ""
        }`
      : opts.slag === "fornyet"
        ? "Her er en ny lisenskode til Ordlyd. Den gamle koden slutter å virke."
        : "Takk for at du vil prøve Ordlyd — lese- og skrivestøtte som kjører på din egen maskin.";

  const tekst = `${innledning}

DIN LISENSKODE
${kode}

${gyldighet}

SLIK KOMMER DU I GANG
1. Installer Ordlyd fra Microsoft Edge Add-ons.
2. Klikk Ordlyd-ikonet i verktoylinja.
3. Skriv inn e-postadressen din og lisenskoden over, og trykk Aktiver.

Du gjor dette bare en gang pa hver maskin.

Veiledninger og hjelp: https://www.ordlyd.no/

Mister du koden, kan du hente en ny pa https://lisens.ordlyd.no/registrer

--
Ordlyd
Denne e-posten ble sendt fordi noen registrerte denne adressen pa
lisens.ordlyd.no. Var det ikke deg, kan du se bort fra den — koden virker
ikke uten at noen ogsa har adressen din.`;

  const html = `<!doctype html>
<html lang="nb"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
<title>${emne}</title></head>
<body style="margin:0;padding:0;background:#eef1f1;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f1;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;padding:28px;font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#142124;">

<tr><td style="font-size:22px;font-weight:700;padding-bottom:14px;">Ordlyd</td></tr>

<tr><td style="font-size:16px;line-height:1.6;padding-bottom:22px;">${innledning}</td></tr>

<tr><td style="padding-bottom:8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5a6b7d;">Din lisenskode</td></tr>
<tr><td align="center" style="background:#f1f5f9;border-radius:8px;padding:20px;">
  <div style="font-family:Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:.22em;color:#142124;">${kode}</div>
</td></tr>

<tr><td style="font-size:15px;line-height:1.6;padding:18px 0 24px;">${gyldighet}</td></tr>

<tr><td style="font-size:15px;font-weight:700;padding-bottom:10px;">Slik kommer du i gang</td></tr>
<tr><td style="font-size:15px;line-height:1.7;padding-bottom:24px;">
  1. Installer Ordlyd fra Microsoft Edge Add-ons.<br />
  2. Klikk Ordlyd-ikonet i verktøylinja.<br />
  3. Skriv inn e-postadressen din og lisenskoden over, og trykk <strong>Aktiver</strong>.
</td></tr>

<tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px;color:#4a5b5f;">
  Du gjør dette bare én gang på hver maskin. Veiledninger og hjelp finner du på
  <a href="https://www.ordlyd.no/" style="color:#2563eb;">ordlyd.no</a>.
</td></tr>

<tr><td style="border-top:1px solid #e2e8f0;padding-top:18px;font-size:13px;line-height:1.6;color:#5a6b7d;">
  Mister du koden, kan du hente en ny på
  <a href="https://lisens.ordlyd.no/registrer" style="color:#2563eb;">lisens.ordlyd.no/registrer</a>.<br /><br />
  Denne e-posten ble sendt fordi noen registrerte denne adressen på lisens.ordlyd.no.
  Var det ikke deg, kan du se bort fra den — koden virker ikke uten at noen også har adressen din.
</td></tr>

</table></td></tr></table></body></html>`;

  return { emne, html, tekst };
}
