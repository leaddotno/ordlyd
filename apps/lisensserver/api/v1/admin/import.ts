/**
 * POST /api/v1/admin/import — importer e-postliste til en pool.
 *
 * Svaret inneholder klartekstkodene. Det er ENGANGS-EKSPORTEN som gis
 * videre til foreningen eller kommunen — serveren beholder bare hasher,
 * så listen kan aldri hentes ut på nytt.
 */

import { vercelHandler, requireString } from "../../../src/http.js";
import { getDb, getSql, getPepper, newId, ok, badRequest } from "../../../src/runtime.js";
import { loesInnlogget, erNektet, krevPanelhode, somAktor } from "../../../src/admin-auth.js";
import { krevEndring, krevKunde } from "../../../src/tilgang.js";
import { poolensKunde } from "../../../src/admin-queries.js";
import { importEntries } from "../../../src/logic.js";

const MAX_EMAILS_PER_CALL = 5000;

export default vercelHandler("POST", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;
  const vakt = krevPanelhode(req, meg) ?? krevEndring(meg);
  if (vakt) return vakt;

  const poolId = requireString(req.body, "poolId");
  const emails = req.body.emails;
  if (!poolId) return badRequest("poolId er påkrevd");
  if (!Array.isArray(emails) || emails.length === 0) return badRequest("emails må være en ikke-tom liste");
  if (emails.length > MAX_EMAILS_PER_CALL) {
    return badRequest(`maks ${MAX_EMAILS_PER_CALL} adresser per kall — del opp listen`);
  }
  if (!emails.every((e) => typeof e === "string")) return badRequest("emails må inneholde bare tekst");

  const kunde = await poolensKunde(getSql(), poolId);
  if (!kunde || krevKunde(meg, kunde)) return { status: 404, body: { feil: "ukjent-pool" } };

  const a = somAktor(meg);
  const result = await importEntries(getDb(), getPepper(), poolId, emails as string[], newId, {
    actor: a.actor,
    actorId: a.actorId,
    actorKind: a.actorKind,
    tenantId: kunde,
  });

  return ok({
    antallImportert: result.imported.length,
    antallFlyttet: result.moved.length,
    antallHosAnnenKunde: result.claimedElsewhere.length,
    antallHoppetOver: result.skipped.length,
    hoppetOver: result.skipped,
    /**
     * Flyttet fra prøvelisens. Disse har med vilje INGEN kode i svaret:
     * brukeren beholder koden hun har, og utvidelsen fortsetter å virke.
     */
    flyttet: result.moved,
    /** Krever et bevisst valg — se importEntries for hvorfor. */
    hosAnnenKunde: result.claimedElsewhere,
    // Eneste gang de nye kodene finnes i klartekst. Lagre dem trygt nå.
    lisenser: result.imported,
  });
}, { cors: false });
