/**
 * Ende-til-ende-test mot en LIVE lisensserver.
 *
 * Kjører hele kjeden mot den deployede serveren: helsesjekk → import av
 * lisenser → innlogging → lokal verifisering av kvitteringens signatur →
 * fornyelse → stenging → bekreft at fornyelse nå avslås.
 *
 * Kjør:
 *   ORDLYD_BASE_URL=https://<prosjekt>.vercel.app \
 *   ORDLYD_ADMIN_TOKEN=<ADMIN_TOKEN> \
 *   ORDLYD_TEST_POOL_ID=<pool_id fra seed-testkunde.sql> \
 *   pnpm exec tsx scripts/smoke-lisensserver.mts
 *
 * På Windows PowerShell settes variablene med $env:NAVN = "verdi" først.
 *
 * Testen oppretter ekte rader i basen, men bare under testkunden fra
 * seed-testkunde.sql. Rydd opp med:
 *   delete from tenants where slug = 'test-kunde';
 */
import { importVerifyKeys, verifyReceipt } from "../packages/license-core/src/index.js";

const BASE = (process.env.ORDLYD_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.ORDLYD_ADMIN_TOKEN ?? "";
const POOL = process.env.ORDLYD_TEST_POOL_ID ?? "";

if (!BASE || !TOKEN || !POOL) {
  console.error(
    "Mangler miljøvariabler.\n" +
      "  ORDLYD_BASE_URL      f.eks. https://ordlyd.vercel.app\n" +
      "  ORDLYD_ADMIN_TOKEN   samme verdi som ADMIN_TOKEN i Vercel\n" +
      "  ORDLYD_TEST_POOL_ID  pool_id fra supabase/seed-testkunde.sql",
  );
  process.exit(2);
}

let failed = 0;
let step = 0;
function report(label: string, ok: boolean, detail?: unknown): void {
  step++;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${step}. ${label}`);
  if (!ok && detail !== undefined) console.log(`     ${JSON.stringify(detail)}`);
}

async function call(
  path: string,
  init?: { method?: string; body?: unknown; token?: string },
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* tomt eller ikke-JSON svar */
  }
  return { status: res.status, json };
}

console.log(`Tester ${BASE}\n`);

// 1. Helsesjekk — database, nøkler og pepper
const health = await call("/api/health");
report(
  "helsesjekk: database, signeringsnøkkel og pepper på plass",
  health.status === 200 && health.json?.ok === true,
  health.json,
);
if (health.status !== 200) {
  console.log("\nAvbryter — resten av testen krever en frisk server.");
  process.exit(1);
}

// 2. Offentlig nøkkelsett, brukt til å verifisere kvitteringen lokalt
const keysRes = await call("/api/v1/keys");
report("offentlig nøkkelsett kan hentes", keysRes.status === 200 && Boolean(keysRes.json?.kid), keysRes.json);
const trusted = [await importVerifyKeys(keysRes.json)];

// 3. Import: to lisenser med unike testadresser
const stamp = Date.now();
const emails = [`smoke-${stamp}-a@test.invalid`, `smoke-${stamp}-b@test.invalid`];
const imp = await call("/api/v1/admin/import", {
  method: "POST",
  token: TOKEN,
  body: { poolId: POOL, emails },
});
report(
  "import av 2 lisenser gir 2 koder i engangs-eksporten",
  imp.status === 200 && imp.json?.antallImportert === 2 && imp.json?.lisenser?.length === 2,
  imp.json,
);
if (imp.status !== 200) {
  console.log("\nAvbryter — fikk ikke importert lisenser.");
  process.exit(1);
}
const lisens = imp.json.lisenser[0] as { email: string; code: string };

// 4. Feil kode skal avvises
const wrong = await call("/api/v1/login", {
  method: "POST",
  body: { email: lisens.email, code: "0000000", product: "edge-extension" },
});
report("feil kode avvises med 401", wrong.status === 401, wrong.json);

// 5. Riktig kode logger inn
const login = await call("/api/v1/login", {
  method: "POST",
  body: { email: lisens.email, code: lisens.code, product: "edge-extension", version: "0.0.1" },
});
report(
  "riktig kode gir kvittering, installId og installSecret",
  login.status === 200 && Boolean(login.json?.receipt && login.json?.installId && login.json?.installSecret),
  login.json,
);
if (login.status !== 200) process.exit(1);

// 6. Kvitteringen verifiseres LOKALT mot serverens offentlige nøkkel
const nowSec = Math.floor(Date.now() / 1000);
const v = await verifyReceipt(login.json.receipt, trusted, nowSec);
const dagerGyldig = v.payload ? Math.round((v.payload.exp - nowSec) / 86_400) : 0;
report(
  `kvitteringens signatur er gyldig (via ${v.via}) og varer ${dagerGyldig} dager`,
  v.ok && v.state === "aktiv" && dagerGyldig >= 99,
  { reason: v.reason, state: v.state, dagerGyldig },
);
report(
  "kvitteringen bærer produktrettighetene fra poolen",
  v.payload?.products?.["edge-extension"]?.features?.includes("tts") === true,
  v.payload?.products,
);

// 7. Fornyelse med installasjonshemmeligheten
const refresh = await call("/api/v1/license/refresh", {
  method: "POST",
  body: {
    installId: login.json.installId,
    installSecret: login.json.installSecret,
    product: "edge-extension",
    version: "0.0.1",
  },
});
report("fornyelse gir ny kvittering", refresh.status === 200 && Boolean(refresh.json?.receipt), refresh.json);

// 8. Feil hemmelighet skal avvises
const badRefresh = await call("/api/v1/license/refresh", {
  method: "POST",
  body: { installId: login.json.installId, installSecret: "feil", product: "edge-extension" },
});
report("fornyelse med feil hemmelighet avvises med 403", badRefresh.status === 403, badRefresh.json);

// 9. Stenging krever admin-token
const noAuth = await call("/api/v1/admin/status", { method: "POST", body: { entryId: "x", status: "stengt" } });
report("stenging uten admin-token avvises med 401", noAuth.status === 401, noAuth.json);

// 10. Admin-endepunktene panelet bruker
const oversikt = await call("/api/v1/admin/overview", { token: TOKEN });
report(
  "oversikt gir kunder, flaggede og revisjonslogg",
  oversikt.status === 200 && Array.isArray(oversikt.json?.kunder) && Array.isArray(oversikt.json?.flaggede) && Array.isArray(oversikt.json?.logg),
  oversikt.json,
);

const lisenser = await call(`/api/v1/admin/entries?poolId=${POOL}`, { token: TOKEN });
report(
  "lisenslisten viser maskert e-post og aldri koden",
  lisenser.status === 200 &&
    Array.isArray(lisenser.json?.lisenser) &&
    lisenser.json.lisenser.length >= 2 &&
    lisenser.json.lisenser.every((l: any) => l.epost.includes("***") && !("code" in l)),
  lisenser.json?.lisenser?.slice(0, 2),
);

const ugyldigPool = await call("/api/v1/admin/entries?poolId=ikke-en-uuid", { token: TOKEN });
report("ugyldig poolId avvises med 400", ugyldigPool.status === 400, ugyldigPool.json);

// 11. Selve panelet skal være tilgjengelig
const panel = await fetch(`${BASE}/admin/`, { redirect: "follow" });
const panelHtml = panel.ok ? await panel.text() : "";
report(
  "superadmin-panelet svarer og er merket noindex",
  panel.ok && panelHtml.includes("Ordlyd — superadmin") && panelHtml.includes("noindex"),
  { status: panel.status },
);

console.log(
  failed === 0
    ? `\nALLE ${step} STEG OK — lisensserveren fungerer ende til ende.\n` +
        "Rydd opp testdata i Supabase:\n  delete from tenants where slug = 'test-kunde';"
    : `\n${failed} av ${step} steg FEILET`,
);
process.exit(failed === 0 ? 0 : 1);
