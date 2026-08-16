/**
 * Tester rollemodellen og kundeavgrensningen.
 *
 * Dette er den delen av adminsystemet med størst skadepotensial: en
 * feil her betyr at en kunde ser en annen kundes medlemsliste. Testene
 * er derfor skrevet som påstander om hva hver rolle IKKE får, ikke bare
 * hva den får.
 *
 * Kjør:  pnpm exec tsx scripts/test-tilgang.mts
 */
import {
  kanEndre, kanStyreAdministratorer, kanEndreGlobaltOppsett, kanOppretteKunder,
  krevesTotrinn, serKunde, kundefilter, omfangErGyldig, serLoggLinje,
  krevEndring, krevAdministratorstyring, krevKunde, krevGlobaltOppsett,
  type Innlogget, type Rolle,
} from "../apps/lisensserver/src/tilgang.js";

let feil = 0;
let n = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

const KUNDE_A = "11111111-1111-1111-1111-111111111111";
const KUNDE_B = "22222222-2222-2222-2222-222222222222";

const som = (rolle: Rolle, kunder: string[] | null): Innlogget => ({
  adminId: "00000000-0000-0000-0000-000000000000",
  navn: "Test", epost: "test@ordlyd.no", rolle, kunder, kilde: "okt",
});

const eier = som("eier", null);
const forvalter = som("forvalter", null);
const kundeadminA = som("kundeadmin", [KUNDE_A]);
const revisorA = som("revisor", [KUNDE_A]);

/* --- Hvem kan endre --- */
sjekk("eier kan endre", kanEndre(eier));
sjekk("forvalter kan endre", kanEndre(forvalter));
sjekk("kundeadmin kan endre", kanEndre(kundeadminA));
sjekk("REVISOR KAN IKKE ENDRE", !kanEndre(revisorA));
sjekk("krevEndring slipper forvalter gjennom", krevEndring(forvalter) === null);
sjekk("krevEndring stopper revisor med 403", krevEndring(revisorA)?.status === 403);

/* --- Administratorstyring: bare eier --- */
sjekk("eier kan styre administratorer", kanStyreAdministratorer(eier));
sjekk("FORVALTER KAN IKKE opprette administratorer", !kanStyreAdministratorer(forvalter));
sjekk("kundeadmin kan ikke opprette administratorer", !kanStyreAdministratorer(kundeadminA));
sjekk("revisor kan ikke opprette administratorer", !kanStyreAdministratorer(revisorA));
sjekk("krevAdministratorstyring gir 403 for forvalter", krevAdministratorstyring(forvalter)?.status === 403);

/* --- Globalt oppsett: bare eier --- */
sjekk("eier kan endre globale innstillinger", kanEndreGlobaltOppsett(eier));
sjekk("forvalter kan IKKE endre prøvelengden", !kanEndreGlobaltOppsett(forvalter));
sjekk("krevGlobaltOppsett gir 403 for forvalter", krevGlobaltOppsett(forvalter)?.status === 403);

/* --- Kundeoppretting --- */
sjekk("forvalter kan opprette kunder", kanOppretteKunder(forvalter));
sjekk("kundeadmin kan IKKE opprette nye kunder", !kanOppretteKunder(kundeadminA));

/* --- Kundeavgrensning: kjernen --- */
sjekk("eier ser kunde A", serKunde(eier, KUNDE_A));
sjekk("eier ser kunde B", serKunde(eier, KUNDE_B));
sjekk("kundeadmin for A ser A", serKunde(kundeadminA, KUNDE_A));
sjekk("KUNDEADMIN FOR A SER IKKE B", !serKunde(kundeadminA, KUNDE_B));
sjekk("REVISOR FOR A SER IKKE B", !serKunde(revisorA, KUNDE_B));
sjekk("kundefilter er null for eier", kundefilter(eier) === null);
sjekk("kundefilter er listen for kundeadmin", JSON.stringify(kundefilter(kundeadminA)) === JSON.stringify([KUNDE_A]));

/* --- Fremmed kunde skal se ut som «finnes ikke», ikke «ikke din» --- */
const nektet = krevKunde(kundeadminA, KUNDE_B);
sjekk("fremmed kunde gir 404, ikke 403", nektet?.status === 404, nektet);
sjekk(
  "svaret røper ikke at kunden finnes",
  JSON.stringify(nektet?.body) === JSON.stringify({ feil: "ukjent-kunde" }),
  nektet?.body,
);
sjekk("egen kunde slipper gjennom", krevKunde(kundeadminA, KUNDE_A) === null);

/* --- Tom liste er ikke det samme som «alle» --- */
const tomKundeadmin = som("kundeadmin", []);
sjekk("kundeadmin uten tildelte kunder ser INGENTING", !serKunde(tomKundeadmin, KUNDE_A));
sjekk("tom liste er ikke null", kundefilter(tomKundeadmin) !== null);

/* --- Lovlige kombinasjoner av rolle og omfang --- */
sjekk("eier med null er gyldig", omfangErGyldig("eier", null));
sjekk("forvalter med null er gyldig", omfangErGyldig("forvalter", null));
sjekk("EIER MED TILDELTE KUNDER ER UGYLDIG", !omfangErGyldig("eier", [KUNDE_A]));
sjekk("forvalter med tildelte kunder er ugyldig", !omfangErGyldig("forvalter", [KUNDE_A]));
sjekk("KUNDEADMIN UTEN KUNDER ER UGYLDIG", !omfangErGyldig("kundeadmin", []));
sjekk("kundeadmin med null er ugyldig", !omfangErGyldig("kundeadmin", null));
sjekk("kundeadmin med én kunde er gyldig", omfangErGyldig("kundeadmin", [KUNDE_A]));
sjekk("REVISOR MÅ HA MINST ÉN KUNDE", !omfangErGyldig("revisor", null) && !omfangErGyldig("revisor", []));
sjekk("revisor med kunde er gyldig", omfangErGyldig("revisor", [KUNDE_A]));

/* --- Totrinn --- */
sjekk("eier krever totrinn", krevesTotrinn("eier", false));
sjekk("forvalter krever totrinn", krevesTotrinn("forvalter", false));
sjekk("kundeadmin krever totrinn", krevesTotrinn("kundeadmin", false));
sjekk("revisor krever ikke totrinn som standard", !krevesTotrinn("revisor", false));
sjekk("revisor KAN kreves totrinn per konto", krevesTotrinn("revisor", true));
sjekk(
  "flagget kan ikke slå AV totrinn for de tre øverste",
  krevesTotrinn("eier", false) && krevesTotrinn("forvalter", false) && krevesTotrinn("kundeadmin", false),
);

/* --- Revisjonsloggen --- */
sjekk("eier ser globale logglinjer", serLoggLinje(eier, null));
sjekk("forvalter ser globale logglinjer", serLoggLinje(forvalter, null));
sjekk("KUNDEADMIN SER IKKE GLOBALE LOGGLINJER", !serLoggLinje(kundeadminA, null));
sjekk("REVISOR SER IKKE GLOBALE LOGGLINJER", !serLoggLinje(revisorA, null));
sjekk("revisor for A ser As logglinjer", serLoggLinje(revisorA, KUNDE_A));
sjekk("REVISOR FOR A SER IKKE Bs LOGGLINJER", !serLoggLinje(revisorA, KUNDE_B));

/* --- Ingen rolle slipper unna avgrensningen ved et uhell --- */
const alleRoller: Rolle[] = ["eier", "forvalter", "kundeadmin", "revisor"];
sjekk(
  "bare eier og forvalter kan ha ubegrenset omfang",
  alleRoller.filter((r) => omfangErGyldig(r, null)).join(",") === "eier,forvalter",
  alleRoller.filter((r) => omfangErGyldig(r, null)),
);

console.log(feil === 0 ? `\nALLE ${n} OK` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
