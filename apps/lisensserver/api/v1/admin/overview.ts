/**
 * GET /api/v1/admin/overview — kunder, pooler og nøkkeltall til panelets forside.
 * Tar også med flaggede lisenser og revisjonslogg, slik at panelet klarer
 * seg med ett kall.
 *
 * Alt er avgrenset til den innloggedes kunder. En kundeadmin ser en
 * forside der andre kunder rett og slett ikke finnes.
 */

import { vercelHandler } from "../../../src/http.js";
import { ok, getSql } from "../../../src/runtime.js";
import { loesInnlogget, erNektet } from "../../../src/admin-auth.js";
import { kanEndre, kanStyreAdministratorer, kanEndreGlobaltOppsett } from "../../../src/tilgang.js";
import {
  overview, flagged, auditTail, FLAG_MIN_INSTALLS, FLAG_MIN_NETS_7D,
} from "../../../src/admin-queries.js";

export default vercelHandler("GET", async (req) => {
  const t = await loesInnlogget(req);
  if (erNektet(t)) return t.svar;
  const { meg } = t;

  const sql = getSql();
  const [kunder, flaggede, logg] = await Promise.all([
    overview(sql, meg),
    flagged(sql, meg),
    auditTail(sql, meg, 40),
  ]);

  return ok({
    kunder,
    flaggede,
    logg,
    terskler: { installasjoner: FLAG_MIN_INSTALLS, nett7d: FLAG_MIN_NETS_7D },
    /*
     * Panelet bruker dette til å skjule knapper det ikke er tillatt å
     * bruke. Serveren håndhever uansett — dette sparer bare brukeren for
     * å trykke på noe som ville blitt avvist.
     */
    meg: {
      navn: meg.navn,
      epost: meg.epost,
      rolle: meg.rolle,
      alleKunder: meg.kunder === null,
      kanEndre: kanEndre(meg),
      kanStyreAdministratorer: kanStyreAdministratorer(meg),
      kanEndreGlobaltOppsett: kanEndreGlobaltOppsett(meg),
    },
  });
}, { cors: false });
