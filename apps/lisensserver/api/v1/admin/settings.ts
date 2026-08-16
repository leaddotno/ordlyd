/**
 * POST /api/v1/admin/settings — les (tom kropp) eller endre innstillinger.
 *
 * Finnes for at prøvelengden og om fornyelse er tillatt skal kunne endres i
 * drift, uten ny utrulling og uten å måtte spørre en utvikler.
 *
 * LESING er tillatt for alle innloggede; ENDRING krever eier. Dette er
 * globale valg som gjelder hele tjenesten, ikke én kunde, og hører derfor
 * ikke hjemme hos en forvalter eller kundeadmin.
 */

import { vercelHandler } from "../../../src/http.js";
import { getDb, ok, badRequest } from "../../../src/runtime.js";
import { loesInnlogget, erNektet, krevPanelhode, somAktor } from "../../../src/admin-auth.js";
import { krevEndring, krevGlobaltOppsett } from "../../../src/tilgang.js";
import { lesInnstillinger } from "../../../src/logic.js";

/** Bare disse kan endres, og bare til fornuftige verdier. */
const TILLATTE: Record<string, (v: unknown) => boolean> = {
  registrering_apen: (v) => typeof v === "boolean",
  prove_fornyelse_tillatt: (v) => typeof v === "boolean",
  prove_dager: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3650,
  prove_pool_id: (v) => typeof v === "string" && v.length > 0,
};

export default vercelHandler("POST", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;

  const db = getDb();
  const nøkler = Object.keys(req.body ?? {});

  // GET-lignende bruk: tom kropp betyr «bare les».
  if (nøkler.length === 0) {
    return ok({ raa: await db.getSettings(), tolket: await lesInnstillinger(db) });
  }

  const vakt = krevPanelhode(req, meg) ?? krevEndring(meg) ?? krevGlobaltOppsett(meg);
  if (vakt) return vakt;

  const ukjente = nøkler.filter((k) => !(k in TILLATTE));
  if (ukjente.length) return badRequest(`kan ikke endres: ${ukjente.join(", ")}`);

  const ugyldige = nøkler.filter((k) => !TILLATTE[k](req.body[k]));
  if (ugyldige.length) {
    return badRequest(
      `ugyldig verdi for: ${ugyldige.join(", ")} — prove_dager må være 1–3650, ` +
        "de andre må være true/false",
    );
  }

  for (const k of nøkler) await db.setSetting(k, req.body[k]);

  const a = somAktor(meg);
  // tenantId er med vilje null: dette er en global handling, og skal
  // derfor bare være synlig for eier og forvalter i revisjonsloggen.
  await db.audit(a.actor, "endre-innstilling", { endret: nøkler }, {
    actorId: a.actorId,
    actorKind: a.actorKind,
    tenantId: null,
  });

  return ok({ raa: await db.getSettings(), tolket: await lesInnstillinger(db) });
}, { cors: false });
