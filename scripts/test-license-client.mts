/**
 * Tester lisensklientens tilstandsmaskin — uten nettleser.
 * Kjør: pnpm exec tsx scripts/test-license-client.mts
 *
 * Lagring, nettverk og klokke er injisert, så vi kan spole tiden framover,
 * skru klokka bakover og la serveren feile på kommando.
 */
import {
  generateSigningKeys,
  exportPublicJwks,
  signReceipt,
  RECEIPT_TTL_SEC,
  RECEIPT_SOFT_TTL_SEC,
  type ReceiptPayload,
} from "../packages/license-core/src/index.js";
import {
  LicenseClient,
  maskEpost,
  REFRESH_INTERVAL_SEC,
  CLOCK_SLACK_SEC,
  type StoredLicense,
  type LicenseStorage,
} from "../packages/license-client/src/index.js";

let failed = 0;
let n = 0;
const check = (label: string, ok: boolean, detail?: unknown): void => {
  n++;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok && detail !== undefined) console.log(`     ${JSON.stringify(detail)}`);
};

const ALLE = ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"];
const NOW0 = 1_786_600_000;

const keys = await generateSigningKeys("sk-test");
const jwks = await exportPublicJwks(keys);

class MinneLager implements LicenseStorage {
  value: StoredLicense | null = null;
  async read() { return this.value; }
  async write(v: StoredLicense) { this.value = { ...v }; }
  async clear() { this.value = null; }
}

async function lagKvittering(
  iat: number,
  features = ALLE,
  kid = "sk-test",
  ekstra: Partial<ReceiptPayload> = {},
): Promise<string> {
  const payload: ReceiptPayload = {
    v: 1, kid, iss: "https://lisens.ordlyd.no",
    sub: "code:abc", tenant: "dysleksi-norge", install: "inst-1",
    products: { "edge-extension": { features } },
    iat, softExp: iat + RECEIPT_SOFT_TTL_SEC, exp: iat + RECEIPT_TTL_SEC, serverTime: iat,
    ...ekstra,
  };
  return signReceipt(payload, kid === "sk-test" ? keys : await generateSigningKeys(kid));
}

/** Lagret lisens med en gitt kvittering, brukt av flere tester. */
function lagretMed(receipt: string, tid: number): StoredLicense {
  return {
    receipt, installId: "i1", installSecret: "s1", epostMaskert: "k***@eksempel.no",
    highWaterSec: tid, sisteForsokSec: tid, sisteSuksessSec: tid, sisteAvslag: null,
  };
}

/** Bygger en klient med kontrollert tid og et skriptet serversvar. */
function lagKlient(opts: {
  lager: MinneLager;
  tid: () => number;
  svar?: (path: string, body: any) => { status: number; json: any } | "nettverksfeil";
}) {
  const fetchImpl = (async (url: any, init: any) => {
    const path = String(url).replace("https://lisens.test", "");
    const body = init?.body ? JSON.parse(init.body) : {};
    const r = opts.svar?.(path, body);
    if (r === "nettverksfeil" || r === undefined) throw new Error("nettverk nede");
    return { status: r.status, json: async () => r.json } as unknown as Response;
  }) as unknown as typeof fetch;

  return new LicenseClient({
    baseUrls: ["https://lisens.test"],
    trustedKeys: [jwks],
    product: "edge-extension",
    version: "0.0.1",
    storage: opts.lager,
    now: opts.tid,
    fetchImpl,
  });
}

/* ---------- Ulisensiert ---------- */
console.log("— Uten lisens —");
{
  const lager = new MinneLager();
  const k = lagKlient({ lager, tid: () => NOW0 });
  const s = await k.state();
  check("fersk installasjon er ulisensiert og har ingen funksjoner", s.status === "ulisensiert" && s.funksjoner.length === 0, s);
  check("ingen funksjoner er tillatt", !(await k.hasFeature("tts")));
}

/* ---------- Innlogging ---------- */
console.log("\n— Innlogging —");
{
  const lager = new MinneLager();
  let tid = NOW0;
  const k = lagKlient({
    lager, tid: () => tid,
    svar: (path) => path === "/api/v1/login"
      ? { status: 200, json: { receipt: kvittering, installId: "i1", installSecret: "s1" } }
      : { status: 404, json: {} },
  });
  const kvittering = await lagKvittering(NOW0);

  const r = await k.login("Kari@Eksempel.no", "123 4567");
  check("innlogging lykkes", r.ok, r);
  const s = await k.state();
  check("status er aktiv med alle funksjoner", s.status === "aktiv" && s.funksjoner.length === 5, s);
  check("dager igjen er 100", s.dagerTilKontaktfrist === 100, s.dagerTilKontaktfrist);
  check("e-post lagres maskert, ikke i klartekst", s.epostMaskert === "k***@eksempel.no" && JSON.stringify(lager.value).includes("kari@eksempel.no") === false, s.epostMaskert);
  check("kundenavn hentes fra kvitteringen", s.kunde === "dysleksi-norge");
}

/* ---------- Avviste innlogginger ---------- */
console.log("\n— Avviste innlogginger —");
for (const [status, forventet] of [[401, "stemmer ikke"], [429, "For mange forsøk"]] as Array<[number, string]>) {
  const lager = new MinneLager();
  const k = lagKlient({ lager, tid: () => NOW0, svar: () => ({ status, json: { feil: "avvist" } }) });
  const r = await k.login("a@b.no", "1234567");
  check(`${status} gir forståelig beskjed og lagrer ingenting`,
    !r.ok && r.feil.includes(forventet) && lager.value === null, r);
}
{
  const lager = new MinneLager();
  const k = lagKlient({ lager, tid: () => NOW0, svar: () => "nettverksfeil" });
  const r = await k.login("a@b.no", "1234567");
  check("nettverksfeil gir beskjed om nettforbindelse", !r.ok && r.feil.includes("nettforbindelse"), r);
}
{
  // Kvittering signert med en nøkkel klienten ikke stoler på
  const fremmed = await generateSigningKeys("sk-test");
  const falsk = await signReceipt(
    { v: 1, kid: "sk-test", iss: "x", sub: "s", tenant: "t", install: "i",
      products: { "edge-extension": { features: ALLE } },
      iat: NOW0, softExp: NOW0 + 10, exp: NOW0 + RECEIPT_TTL_SEC, serverTime: NOW0 },
    fremmed,
  );
  const lager = new MinneLager();
  const k = lagKlient({ lager, tid: () => NOW0, svar: () => ({ status: 200, json: { receipt: falsk, installId: "i", installSecret: "s" } }) });
  const r = await k.login("a@b.no", "1234567");
  check("kvittering fra ukjent nøkkel avvises og lagres ikke", !r.ok && lager.value === null, r);
}

/* ---------- Livsløpet: aktiv → varsel → degradert ---------- */
console.log("\n— Livsløp over 100 dager —");
{
  const lager = new MinneLager();
  let tid = NOW0;
  const kvittering = await lagKvittering(NOW0);
  lager.value = {
    receipt: kvittering, installId: "i1", installSecret: "s1",
    epostMaskert: "k***@eksempel.no", highWaterSec: NOW0,
    sisteForsokSec: NOW0, sisteSuksessSec: NOW0, sisteAvslag: null,
  };
  const k = lagKlient({ lager, tid: () => tid });

  tid = NOW0 + 10 * 86_400;
  check("dag 10: aktiv", (await k.state()).status === "aktiv");

  tid = NOW0 + RECEIPT_SOFT_TTL_SEC + 60;
  const varsel = await k.state();
  check("dag 70: varsel, men alle funksjoner virker fortsatt", varsel.status === "varsel" && varsel.funksjoner.length === 5, varsel);

  tid = NOW0 + RECEIPT_TTL_SEC + 60;
  const degradert = await k.state();
  check("dag 100: degradert", degradert.status === "degradert", degradert);
  check("degradert beholder opplesing", degradert.funksjoner.includes("tts"), degradert.funksjoner);
  check("degradert slår av skrivehjelpen", !degradert.funksjoner.includes("prediksjon") && !degradert.funksjoner.includes("ordbok"), degradert.funksjoner);
  check("hasFeature følger degradert modus", (await k.hasFeature("tts")) && !(await k.hasFeature("stavekontroll")));
}

/* ---------- Lisensens egen sluttdato vs. kontakt med serveren ---------- */
console.log("\n— Løpende lisens kontra lisens med sluttdato —");
{
  // Løpende lisens: ingen sluttdato i kvitteringen
  const lager = new MinneLager();
  lager.value = lagretMed(await lagKvittering(NOW0, ALLE, "sk-test", { licenseValidTo: null, plan: "medlem" }), NOW0);
  const k = lagKlient({ lager, tid: () => NOW0 + 5 * 86_400 });
  const s = await k.state();
  check("løpende lisens har ingen sluttdato å vise", s.lisensSlutt === null, s);
  check("lisenstypen følger med i kvitteringen", s.lisenstype === "medlem", s.lisenstype);
  check("løpende lisens er aktiv med alle funksjoner", s.status === "aktiv" && s.funksjoner.length === 5, s);
}
{
  // Eldre kvittering uten de nye feltene skal tolkes som løpende
  const lager = new MinneLager();
  lager.value = lagretMed(await lagKvittering(NOW0), NOW0);
  const k = lagKlient({ lager, tid: () => NOW0 + 86_400 });
  const s = await k.state();
  check("kvittering uten de nye feltene tolkes som løpende", s.lisensSlutt === null && s.lisenstype === null && s.status === "aktiv", s);
}
{
  // Lisens med sluttdato fram i tid
  const slutt = NOW0 + 30 * 86_400;
  const lager = new MinneLager();
  lager.value = lagretMed(await lagKvittering(NOW0, ALLE, "sk-test", { licenseValidTo: slutt, plan: "skole" }), NOW0);
  const k = lagKlient({ lager, tid: () => NOW0 + 10 * 86_400 });
  const s = await k.state();
  check("sluttdato fram i tid: aktiv, og datoen er tilgjengelig", s.status === "aktiv" && s.lisensSlutt === slutt, s);
}
{
  // Sluttdato passert, men kvitteringen fortsatt gyldig i ukevis
  const slutt = NOW0 + 10 * 86_400;
  const lager = new MinneLager();
  lager.value = lagretMed(await lagKvittering(NOW0, ALLE, "sk-test", { licenseValidTo: slutt, plan: "prove" }), NOW0);
  const k = lagKlient({ lager, tid: () => NOW0 + 20 * 86_400 });
  const s = await k.state();
  check("passert sluttdato gir status «utgatt», ikke «degradert»", s.status === "utgatt", s);
  check("utgått lisens beholder opplesing", s.funksjoner.includes("tts"), s.funksjoner);
  check("utgått lisens slår av skrivehjelpen", !s.funksjoner.includes("prediksjon"), s.funksjoner);
  check("kontaktfristen er fortsatt langt fram — det er lisensen som er ute", (s.dagerTilKontaktfrist ?? 0) > 70, s.dagerTilKontaktfrist);
}

/* ---------- Klokkejuks ---------- */
console.log("\n— Klokka —");
{
  const lager = new MinneLager();
  let tid = NOW0 + 50 * 86_400;
  const kvittering = await lagKvittering(NOW0);
  lager.value = {
    receipt: kvittering, installId: "i1", installSecret: "s1", epostMaskert: null,
    highWaterSec: tid, sisteForsokSec: tid, sisteSuksessSec: tid, sisteAvslag: null,
  };
  const k = lagKlient({ lager, tid: () => tid });

  // Skru klokka tilbake til før kvitteringen ble utstedt
  tid = NOW0 - 10 * 86_400;
  const s = await k.state();
  check("klokke skrudd tilbake flagges", s.klokkeAvvik, s);
  check("…men utestenger ikke — funksjonene virker", s.status === "aktiv" && s.funksjoner.length === 5, s);
  check("…og gir ikke ekstra levetid (regnes fra høyvannsmerket)", s.dagerTilKontaktfrist === 50, s.dagerTilKontaktfrist);

  // Liten avvik innenfor slakken skal ikke flagges
  tid = NOW0 + 50 * 86_400 - (CLOCK_SLACK_SEC - 3600);
  check("avvik innenfor 48 timer flagges ikke", !(await k.state()).klokkeAvvik);
}

/* ---------- Fornyelse ---------- */
console.log("\n— Fornyelse —");
{
  const lager = new MinneLager();
  let tid = NOW0;
  let nyKvittering = "";
  const k = lagKlient({
    lager, tid: () => tid,
    svar: (path) => path === "/api/v1/license/refresh"
      ? { status: 200, json: { receipt: nyKvittering } }
      : { status: 404, json: {} },
  });
  lager.value = {
    receipt: await lagKvittering(NOW0), installId: "i1", installSecret: "s1", epostMaskert: null,
    highWaterSec: NOW0, sisteForsokSec: NOW0, sisteSuksessSec: NOW0, sisteAvslag: null,
  };

  check("fornyer ikke før det er på tid", !(await k.refreshDue()));
  tid = NOW0 + REFRESH_INTERVAL_SEC + 60;
  check("fornyer når 20 timer har gått", await k.refreshDue());

  nyKvittering = await lagKvittering(tid);
  check("fornyelse lykkes", await k.refresh());
  const s = await k.state();
  check("glidende utløp: 100 nye dager fra fornyelsen", s.dagerTilKontaktfrist === 100, s.dagerTilKontaktfrist);
  check("høyvannsmerket flyttet fram", lager.value!.highWaterSec === tid, lager.value!.highWaterSec);
}

/* ---------- Avslag og nettverksfeil sletter ALDRI kvitteringen ---------- */
console.log("\n— Offline-løftet —");
{
  for (const [navn, svar] of [
    ["nettverksfeil", () => "nettverksfeil" as const],
    ["403 stengt konto", () => ({ status: 403, json: { feil: "stengt" } })],
    ["500 serverfeil", () => ({ status: 500, json: {} })],
  ] as Array<[string, any]>) {
    const lager = new MinneLager();
    let tid = NOW0 + REFRESH_INTERVAL_SEC + 60;
    const original = await lagKvittering(NOW0);
    lager.value = {
      receipt: original, installId: "i1", installSecret: "s1", epostMaskert: null,
      highWaterSec: NOW0, sisteForsokSec: NOW0, sisteSuksessSec: NOW0, sisteAvslag: null,
    };
    const k = lagKlient({ lager, tid: () => tid, svar });
    const fornyet = await k.refresh();
    const s = await k.state();
    check(`${navn}: kvitteringen beholdes og lisensen virker`,
      !fornyet && lager.value?.receipt === original && s.status === "aktiv" && s.funksjoner.length === 5,
      { fornyet, status: s.status });
  }
  // Et avslag skal være synlig for brukeren
  const lager = new MinneLager();
  const tid = NOW0 + REFRESH_INTERVAL_SEC + 60;
  lager.value = {
    receipt: await lagKvittering(NOW0), installId: "i1", installSecret: "s1", epostMaskert: null,
    highWaterSec: NOW0, sisteForsokSec: NOW0, sisteSuksessSec: NOW0, sisteAvslag: null,
  };
  const k = lagKlient({ lager, tid: () => tid, svar: () => ({ status: 403, json: { feil: "stengt" } }) });
  await k.refresh();
  check("avslaget vises i tilstanden slik popup kan si det videre", (await k.state()).sisteAvslag === "stengt");
}

/* ---------- Utlogging ---------- */
console.log("\n— Utlogging —");
{
  const lager = new MinneLager();
  lager.value = {
    receipt: await lagKvittering(NOW0), installId: "i1", installSecret: "s1", epostMaskert: null,
    highWaterSec: NOW0, sisteForsokSec: null, sisteSuksessSec: null, sisteAvslag: null,
  };
  const k = lagKlient({ lager, tid: () => NOW0 });
  await k.logout();
  check("utlogging fjerner alt lagret", lager.value === null);
  check("og status er ulisensiert igjen", (await k.state()).status === "ulisensiert");
}

console.log("\n— Maskering —");
check("maskEpost skjuler lokaldelen", maskEpost("Kari.Nordmann@skole.no") === "k***@skole.no");

console.log(failed === 0 ? `\nALLE OK (${n} tester)` : `\n${failed} av ${n} FEILET`);
process.exit(failed === 0 ? 0 : 1);
