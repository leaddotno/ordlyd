/**
 * Lisensklienten — felles for nettleserutvidelsen og senere PC-appen.
 *
 * Kjernepoenget: klienten avgjør selv om den har lisens, ved å verifisere
 * en signatur mot en innebygd offentlig nøkkel. Ingen nettverksforespørsel
 * er nødvendig for å bruke programmet. Serveren kontaktes bare for å
 * fornye kvitteringen, i bakgrunnen, én gang i døgnet.
 *
 * Tre regler bygget inn, fra planens kapittel 5 og 6:
 *
 *  1. **En avslått fornyelse sletter aldri kvitteringen.** Klienten
 *     beholder den til den utløper av seg selv. Det er hele offline-løftet.
 *  2. **Klokkeavvik utestenger aldri.** Vi holder et monotont
 *     høyvannsmerke, så tiden ikke kan skrus tilbake for å forlenge
 *     lisensen — men en skole-PC med feil dato mister ikke opplesingen.
 *  3. **Degradert framfor stengt.** Når kvitteringen har løpt ut, faller
 *     klienten til opplesing alene i stedet for å slå seg av. En elev skal
 *     ikke miste lesestøtten midt i en prøve.
 *
 * Alt av plattform (lagring, nettverk, klokke) injiseres, slik at
 * tilstandsmaskinen kan testes uten nettleser.
 */

import {
  verifyReceipt,
  importVerifyKeys,
  type VerifyKeys,
  type ReceiptPayload,
} from "@ordlyd/license-core";

/** Funksjoner som fortsatt virker etter at kvitteringen har løpt ut. */
export const DEGRADERTE_FUNKSJONER = ["tts"] as const;

/** Hvor lenge klienten venter mellom fornyelsesforsøk når alt går bra. */
export const REFRESH_INTERVAL_SEC = 20 * 3600;
/** Etter et mislykket forsøk: prøv igjen tidligere, men ikke i loop. */
export const RETRY_INTERVAL_SEC = 2 * 3600;
/** Slakk før vi mistenker at klokka er skrudd tilbake. */
export const CLOCK_SLACK_SEC = 48 * 3600;

export interface StoredLicense {
  receipt: string;
  installId: string;
  installSecret: string;
  /** Maskert e-post, kun til visning i popup. Lages lokalt. */
  epostMaskert: string | null;
  /** Monotont høyvannsmerke: seneste tid vi har sett, i sekunder. */
  highWaterSec: number;
  sisteForsokSec: number | null;
  sisteSuksessSec: number | null;
  /** Serverens grunn til å avslå siste fornyelse, hvis den avslo. */
  sisteAvslag: string | null;
}

export interface LicenseStorage {
  read(): Promise<StoredLicense | null>;
  write(value: StoredLicense): Promise<void>;
  clear(): Promise<void>;
}

export interface PublicKeySet {
  kid: string;
  ed25519?: JsonWebKey;
  p256?: JsonWebKey;
}

export interface LicenseClientConfig {
  /** Forsøkes i rekkefølge. Flere adresser gir manøvreringsrom hvis én faller. */
  baseUrls: string[];
  /** Pinnede offentlige nøkler. Tillit kommer HERFRA, aldri fra nettverket. */
  trustedKeys: PublicKeySet[];
  product: string;
  version: string;
  storage: LicenseStorage;
  now?: () => number;
  fetchImpl?: typeof fetch;
  /** Tidsavbrudd per forespørsel i millisekunder. */
  timeoutMs?: number;
}

export type LicenseStatus = "ulisensiert" | "aktiv" | "varsel" | "degradert";

export interface LicenseState {
  status: LicenseStatus;
  /** Funksjonene brukeren faktisk har lov til å bruke nå. */
  funksjoner: string[];
  dagerIgjen: number | null;
  epostMaskert: string | null;
  kunde: string | null;
  /** Systemklokka ser ut til å ha gått bakover. Informativt — sperrer ikke. */
  klokkeAvvik: boolean;
  sisteSuksessSec: number | null;
  sisteAvslag: string | null;
  /** Satt når kvitteringen finnes men ikke kan verifiseres. */
  feil: string | null;
}

export type LoginResult = { ok: true } | { ok: false; feil: string };

const TOM_TILSTAND: LicenseState = {
  status: "ulisensiert",
  funksjoner: [],
  dagerIgjen: null,
  epostMaskert: null,
  kunde: null,
  klokkeAvvik: false,
  sisteSuksessSec: null,
  sisteAvslag: null,
  feil: null,
};

export function maskEpost(epost: string): string {
  const [local, domain] = epost.trim().toLowerCase().split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export class LicenseClient {
  private keys: Promise<VerifyKeys[]> | null = null;

  constructor(private cfg: LicenseClientConfig) {}

  private now(): number {
    return this.cfg.now ? this.cfg.now() : Math.floor(Date.now() / 1000);
  }

  private get fetch(): typeof fetch {
    return this.cfg.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private trusted(): Promise<VerifyKeys[]> {
    this.keys ??= Promise.all(this.cfg.trustedKeys.map((k) => importVerifyKeys(k)));
    return this.keys;
  }

  /**
   * Effektiv tid = den seneste vi kjenner. Å skru klokka tilbake gir derfor
   * ingen ekstra levetid, mens en klokke som står feil framover ikke
   * straffes hardere enn den ville blitt uansett.
   */
  private effectiveNow(stored: StoredLicense | null): number {
    return Math.max(this.now(), stored?.highWaterSec ?? 0);
  }

  async state(): Promise<LicenseState> {
    const stored = await this.cfg.storage.read();
    if (!stored) return TOM_TILSTAND;

    const systemNow = this.now();
    const naa = this.effectiveNow(stored);
    const klokkeAvvik = systemNow < stored.highWaterSec - CLOCK_SLACK_SEC;

    const v = await verifyReceipt(stored.receipt, await this.trusted(), naa);
    if (!v.ok || !v.payload) {
      // Ugyldig signatur eller ukjent nøkkel: vi later ikke som vi har
      // lisens, men vi sletter heller ikke — en nøkkelrotasjon kan gjøre
      // den gyldig igjen etter neste fornyelse.
      return { ...TOM_TILSTAND, epostMaskert: stored.epostMaskert, feil: v.reason ?? "ugyldig kvittering" };
    }

    const p: ReceiptPayload = v.payload;
    const fraKvittering = p.products?.[this.cfg.product]?.features ?? [];
    const utlopt = v.state === "utlopt";
    const status: LicenseStatus = utlopt ? "degradert" : v.state === "varsel" ? "varsel" : "aktiv";

    return {
      status,
      funksjoner: utlopt
        ? fraKvittering.filter((f) => (DEGRADERTE_FUNKSJONER as readonly string[]).includes(f))
        : fraKvittering,
      dagerIgjen: Math.max(0, Math.ceil((p.exp - naa) / 86_400)),
      epostMaskert: stored.epostMaskert,
      kunde: p.tenant,
      klokkeAvvik,
      sisteSuksessSec: stored.sisteSuksessSec,
      sisteAvslag: stored.sisteAvslag,
      feil: null,
    };
  }

  async hasFeature(navn: string): Promise<boolean> {
    return (await this.state()).funksjoner.includes(navn);
  }

  private async post(path: string, body: unknown): Promise<{ status: number; json: any }> {
    let sisteFeil: unknown = new Error("ingen adresser konfigurert");
    for (const base of this.cfg.baseUrls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 15_000);
      try {
        const res = await this.fetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        let json: any = null;
        try {
          json = await res.json();
        } catch {
          /* tomt svar */
        }
        return { status: res.status, json };
      } catch (err) {
        sisteFeil = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw sisteFeil;
  }

  async login(epost: string, kode: string): Promise<LoginResult> {
    let svar: { status: number; json: any };
    try {
      svar = await this.post("/api/v1/login", {
        email: epost.trim(),
        code: kode,
        product: this.cfg.product,
        version: this.cfg.version,
      });
    } catch {
      return { ok: false, feil: "Fikk ikke kontakt med lisensserveren. Sjekk nettforbindelsen." };
    }

    if (svar.status === 429) {
      return { ok: false, feil: "For mange forsøk. Vent et kvarter og prøv igjen." };
    }
    if (svar.status === 401) {
      return { ok: false, feil: "E-posten eller lisenskoden stemmer ikke." };
    }
    if (svar.status !== 200 || !svar.json?.receipt) {
      const grunn = svar.json?.feil === "utenfor-periode"
        ? "Lisensen er utenfor gyldighetsperioden. Kontakt den som ga deg koden."
        : "Serveren svarte uventet. Prøv igjen senere.";
      return { ok: false, feil: grunn };
    }

    // Verifiser før vi lagrer: en kvittering vi ikke kan stole på skal
    // ikke inn i lagringen i det hele tatt.
    const naa = this.now();
    const v = await verifyReceipt(svar.json.receipt, await this.trusted(), naa);
    if (!v.ok || !v.payload) {
      return { ok: false, feil: "Kvitteringen fra serveren kunne ikke verifiseres." };
    }

    await this.cfg.storage.write({
      receipt: svar.json.receipt,
      installId: svar.json.installId,
      installSecret: svar.json.installSecret,
      epostMaskert: maskEpost(epost),
      highWaterSec: Math.max(naa, v.payload.serverTime ?? 0),
      sisteForsokSec: naa,
      sisteSuksessSec: naa,
      sisteAvslag: null,
    });
    return { ok: true };
  }

  async logout(): Promise<void> {
    await this.cfg.storage.clear();
  }

  /** True når det er på tid å prøve en fornyelse. */
  async refreshDue(): Promise<boolean> {
    const stored = await this.cfg.storage.read();
    if (!stored) return false;
    const naa = this.effectiveNow(stored);
    if (stored.sisteSuksessSec === null) return true;
    const sidenSuksess = naa - stored.sisteSuksessSec;
    if (sidenSuksess >= REFRESH_INTERVAL_SEC) {
      const sidenForsok = stored.sisteForsokSec === null ? Infinity : naa - stored.sisteForsokSec;
      return sidenForsok >= RETRY_INTERVAL_SEC;
    }
    return false;
  }

  /**
   * Fornyer kvitteringen hvis det er på tid. Returnerer true hvis en ny
   * kvittering ble hentet.
   *
   * Merk hva som IKKE skjer her: verken nettverksfeil eller et avslag fra
   * serveren fører til at kvitteringen slettes. Klienten fortsetter med
   * den den har, helt til den løper ut av seg selv.
   */
  async refresh(force = false): Promise<boolean> {
    const stored = await this.cfg.storage.read();
    if (!stored) return false;
    if (!force && !(await this.refreshDue())) return false;

    const naa = this.now();
    const forsokt: StoredLicense = { ...stored, sisteForsokSec: Math.max(naa, stored.sisteForsokSec ?? 0) };

    let svar: { status: number; json: any };
    try {
      svar = await this.post("/api/v1/license/refresh", {
        installId: stored.installId,
        installSecret: stored.installSecret,
        product: this.cfg.product,
        version: this.cfg.version,
      });
    } catch {
      await this.cfg.storage.write(forsokt);
      return false;
    }

    if (svar.status === 200 && svar.json?.receipt) {
      const v = await verifyReceipt(svar.json.receipt, await this.trusted(), naa);
      if (!v.ok || !v.payload) {
        // Uverifiserbart svar behandles som om vi ikke fikk noe.
        await this.cfg.storage.write({ ...forsokt, sisteAvslag: "kvittering kunne ikke verifiseres" });
        return false;
      }
      await this.cfg.storage.write({
        ...forsokt,
        receipt: svar.json.receipt,
        highWaterSec: Math.max(forsokt.highWaterSec, naa, v.payload.serverTime ?? 0),
        sisteSuksessSec: naa,
        sisteAvslag: null,
      });
      return true;
    }

    // 403 = stengt konto eller utenfor periode. Kvitteringen beholdes.
    await this.cfg.storage.write({
      ...forsokt,
      sisteAvslag: svar.json?.feil ?? `serveren svarte ${svar.status}`,
    });
    return false;
  }
}
