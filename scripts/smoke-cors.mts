/**
 * Beviser at CORS-innstrammingen IKKE traff utvidelsens endepunkter.
 *
 * Dette er den ene endringen i adminarbeidet som kan ta ned alle
 * brukere: mister /login eller /license/refresh sitt
 * `access-control-allow-origin: *`, klarer ikke utvidelsen å fornye
 * lisensen, og retting ville krevd en ny pakke gjennom Microsofts
 * godkjenning. Testen kjøres FØR og ETTER hver utrulling som rører
 * http.ts.
 *
 * Kjør:  pnpm exec tsx scripts/smoke-cors.mts
 *        ORDLYD_BASE_URL=https://… for et annet miljø
 */

const BASE = (process.env.ORDLYD_BASE_URL ?? "https://lisens.ordlyd.no").replace(/\/$/, "");

/** Utvidelsen kaller fra en chrome-extension://-opprinnelse som skifter mellom bygg. */
const OPPRINNELSE = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

let feil = 0;
let n = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

async function cors(sti: string, metode = "POST"): Promise<{ tillatelse: string | null; status: number }> {
  const res = await fetch(`${BASE}${sti}`, {
    method: "OPTIONS",
    headers: {
      origin: OPPRINNELSE,
      "access-control-request-method": metode,
      "access-control-request-headers": "content-type",
    },
  });
  return { tillatelse: res.headers.get("access-control-allow-origin"), status: res.status };
}

console.log(`Sjekker CORS-skillet mot ${BASE}\n`);

/* --- MÅ være åpne: alt utvidelsen snakker med --- */
const AAPNE: Array<[string, string]> = [
  ["/api/v1/login", "POST"],
  ["/api/v1/license/refresh", "POST"],
  ["/api/v1/keys", "GET"],
  ["/api/v1/version", "GET"],
  ["/api/health", "GET"],
  ["/api/v1/registrer", "POST"],
];
for (const [sti, metode] of AAPNE) {
  const r = await cors(sti, metode);
  sjekk(`ÅPEN: ${sti} svarer med *`, r.tillatelse === "*", r);
}

/* --- MÅ være lukket: adminsiden --- */
const LUKKEDE: Array<[string, string]> = [
  ["/api/v1/admin/overview", "GET"],
  ["/api/v1/admin/entries", "GET"],
  ["/api/v1/admin/import", "POST"],
  ["/api/v1/admin/status", "POST"],
  ["/api/v1/admin/settings", "POST"],
  ["/api/v1/admin/tenant", "POST"],
  ["/api/v1/admin/pool", "POST"],
  ["/api/v1/admin/administratorer", "GET"],
  ["/api/v1/admin/auth/login", "POST"],
  ["/api/v1/admin/auth/totp", "POST"],
  ["/api/v1/admin/auth/meg", "GET"],
  ["/api/v1/admin/auth/konto", "POST"],
];
for (const [sti, metode] of LUKKEDE) {
  const r = await cors(sti, metode);
  // Et endepunkt som ikke FINNES gir også null tillatelse. Uten
  // statuskravet ville testen blitt grønn av at funksjonen manglet —
  // altså grønn av nettopp det den skal fange.
  sjekk(
    `LUKKET: ${sti} finnes og gir ingen CORS-tillatelse`,
    r.tillatelse === null && r.status !== 404,
    r,
  );
}

/* --- Admin skal fortsatt kreve innlogging --- */
for (const sti of ["/api/v1/admin/overview", "/api/v1/admin/administratorer"]) {
  const res = await fetch(`${BASE}${sti}`);
  sjekk(`${sti} krever innlogging`, res.status === 401, { status: res.status });
}

/* --- Innlogging med tull skal ikke røpe om kontoen finnes --- */
const svar = await Promise.all(
  ["finnes-neppe@eksempel.no", "edge-review@ordlyd.no"].map((epost) =>
    fetch(`${BASE}/api/v1/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ epost, passord: "helt-feil-passord-1!" }),
    }).then(async (r) => ({ status: r.status, kropp: await r.text() })),
  ),
);
sjekk(
  "ukjent og kjent adresse gir identisk svar på feil passord",
  svar[0].status === svar[1].status && svar[0].kropp === svar[1].kropp,
  svar,
);

console.log(feil === 0 ? `\nALLE ${n} OK` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
