/**
 * Administratorkontoer, økter og reservekoder — databasesiden.
 *
 * Holdt utenfor Db-grensesnittet av samme grunn som admin-queries.ts:
 * Db er den smale kontrakten innlogging og fornyelse for SLUTTBRUKERE
 * går gjennom, og som testes mot MemoryDb. Adminidentitet er et eget
 * område, og å blande det inn ville blåst opp grensesnittet uten å
 * gjøre den kritiske stien tryggere.
 *
 * Selve regelverket — hvem som får se hva — ligger i tilgang.ts og er
 * testet der uten database.
 */

import type { Sql } from "./db-postgres.js";
import type { Rolle } from "./tilgang.js";

export interface AdminRad {
  id: string;
  epost: string;
  navn: string;
  rolle: Rolle;
  status: "aktiv" | "sperret";
  krevTotrinn: boolean;
  opprettet: string;
  sistInnlogget: string | null;
  /** Tildelte kunder. Tom liste for eier og forvalter — de ser alle. */
  kunder: string[];
}

const somAdmin = (r: any): AdminRad => ({
  id: r.id,
  epost: r.email,
  navn: r.name,
  rolle: r.role,
  status: r.status,
  krevTotrinn: r.krev_totrinn,
  opprettet: new Date(r.created_at).toISOString(),
  sistInnlogget: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
  kunder: r.kunder ?? [],
});

/** Felles utvalg med tildelte kunder samlet i én kolonne. */
const MED_KUNDER = (sql: Sql) => sql`
  coalesce(
    (select array_agg(s.tenant_id::text) from admin_scopes s where s.admin_id = a.id),
    '{}'
  ) as kunder`;

export async function finnAdminPaaEpost(sql: Sql, epost: string): Promise<AdminRad | null> {
  const rows = await sql`
    select a.*, ${MED_KUNDER(sql)}
    from admins a where a.email = ${epost.trim().toLowerCase()} limit 1`;
  return rows[0] ? somAdmin(rows[0]) : null;
}

export async function finnAdmin(sql: Sql, id: string): Promise<AdminRad | null> {
  const rows = await sql`select a.*, ${MED_KUNDER(sql)} from admins a where a.id = ${id} limit 1`;
  return rows[0] ? somAdmin(rows[0]) : null;
}

export async function listAdmins(sql: Sql): Promise<AdminRad[]> {
  const rows = await sql`select a.*, ${MED_KUNDER(sql)} from admins a order by a.name`;
  return rows.map(somAdmin);
}

export async function tellEiere(sql: Sql): Promise<number> {
  const rows = await sql`select count(*)::int as n from admins where role = 'eier' and status = 'aktiv'`;
  return rows[0]?.n ?? 0;
}

export async function opprettAdmin(
  sql: Sql,
  a: { id: string; epost: string; navn: string; rolle: Rolle; krevTotrinn: boolean; opprettetAv: string | null },
): Promise<void> {
  await sql`
    insert into admins (id, email, name, role, krev_totrinn, created_by)
    values (${a.id}, ${a.epost.trim().toLowerCase()}, ${a.navn}, ${a.rolle},
            ${a.krevTotrinn}, ${a.opprettetAv})`;
}

export async function endreAdmin(
  sql: Sql,
  id: string,
  endring: { navn?: string; rolle?: Rolle; status?: "aktiv" | "sperret"; krevTotrinn?: boolean },
): Promise<void> {
  // Ett felt om gangen framfor dynamisk SQL — færre felter, og ingen
  // fristelse til å bygge spørringer med strengsammensetning.
  if (endring.navn !== undefined) await sql`update admins set name = ${endring.navn} where id = ${id}`;
  if (endring.rolle !== undefined) await sql`update admins set role = ${endring.rolle} where id = ${id}`;
  if (endring.status !== undefined) await sql`update admins set status = ${endring.status} where id = ${id}`;
  if (endring.krevTotrinn !== undefined) {
    await sql`update admins set krev_totrinn = ${endring.krevTotrinn} where id = ${id}`;
  }
}

/** Erstatter hele settet. Tom liste fjerner all kundetilknytning. */
export async function settKunder(sql: Sql, adminId: string, tenantIds: string[]): Promise<void> {
  await sql`delete from admin_scopes where admin_id = ${adminId}`;
  for (const t of tenantIds) {
    await sql`insert into admin_scopes (admin_id, tenant_id) values (${adminId}, ${t})
              on conflict do nothing`;
  }
}

export async function merkInnlogging(sql: Sql, adminId: string): Promise<void> {
  await sql`update admins set last_login_at = now() where id = ${adminId}`;
}

/* ------------------------------------------------------------------ *
 * Økter
 * ------------------------------------------------------------------ */

export interface OktRad {
  id: string;
  adminId: string;
  aal: "aal1" | "aal2";
  opprettet: string;
  sistSett: string;
  utloper: string;
  land: string | null;
}

export async function opprettOkt(
  sql: Sql,
  o: {
    id: string; adminId: string; tokenHash: string; aal: "aal1" | "aal2";
    levetidSek: number; netHash: string | null; land: string | null;
  },
): Promise<void> {
  await sql`
    insert into admin_sessions (id, admin_id, token_hash, aal, expires_at, net_hash, land)
    values (${o.id}, ${o.adminId}, ${o.tokenHash}, ${o.aal},
            now() + ${`${o.levetidSek} seconds`}::interval, ${o.netHash}, ${o.land})`;
}

/**
 * Slår opp en levende økt og administratoren den tilhører i ett kall.
 *
 * Filtrerer på utløp, tilbakekalling OG at kontoen fortsatt er aktiv —
 * en sperret konto skal miste tilgangen ved neste forespørsel, ikke når
 * økten tilfeldigvis utløper.
 */
export async function finnLevendeOkt(
  sql: Sql,
  tokenHash: string,
): Promise<{ okt: OktRad; admin: AdminRad } | null> {
  const rows = await sql`
    select
      o.id as okt_id, o.aal, o.created_at as okt_opprettet,
      o.last_seen_at, o.expires_at, o.land,
      a.*, ${MED_KUNDER(sql)}
    from admin_sessions o
    join admins a on a.id = o.admin_id
    where o.token_hash = ${tokenHash}
      and o.revoked_at is null
      and o.expires_at > now()
      and a.status = 'aktiv'
    limit 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    okt: {
      id: r.okt_id,
      adminId: r.id,
      aal: r.aal,
      opprettet: new Date(r.okt_opprettet).toISOString(),
      sistSett: new Date(r.last_seen_at).toISOString(),
      utloper: new Date(r.expires_at).toISOString(),
      land: r.land,
    },
    admin: somAdmin(r),
  };
}

/**
 * Glidende fornyelse, men aldri forbi det absolutte taket regnet fra
 * opprettelsen. En økt som er brukt sammenhengende i en uke må logge
 * inn på nytt.
 */
export async function fornyOkt(sql: Sql, oktId: string, levetidSek: number, maksAlderSek: number): Promise<void> {
  await sql`
    update admin_sessions
    set last_seen_at = now(),
        expires_at = least(
          now() + ${`${levetidSek} seconds`}::interval,
          created_at + ${`${maksAlderSek} seconds`}::interval
        )
    where id = ${oktId}`;
}

export async function tilbakekallOkt(sql: Sql, oktId: string): Promise<void> {
  await sql`update admin_sessions set revoked_at = now() where id = ${oktId} and revoked_at is null`;
}

/** Brukes ved rolleendring, sperring og passordbytte. */
export async function tilbakekallAlleOkter(sql: Sql, adminId: string): Promise<number> {
  const r = await sql`
    update admin_sessions set revoked_at = now()
    where admin_id = ${adminId} and revoked_at is null and expires_at > now()`;
  return r.count;
}

export async function mineOkter(sql: Sql, adminId: string): Promise<OktRad[]> {
  const rows = await sql`
    select id as okt_id, admin_id, aal, created_at as okt_opprettet,
           last_seen_at, expires_at, land
    from admin_sessions
    where admin_id = ${adminId} and revoked_at is null and expires_at > now()
    order by last_seen_at desc`;
  return rows.map((r: any) => ({
    id: r.okt_id,
    adminId: r.admin_id,
    aal: r.aal,
    opprettet: new Date(r.okt_opprettet).toISOString(),
    sistSett: new Date(r.last_seen_at).toISOString(),
    utloper: new Date(r.expires_at).toISOString(),
    land: r.land,
  }));
}

/* ------------------------------------------------------------------ *
 * Reservekoder
 * ------------------------------------------------------------------ */

export async function lagreReservekoder(sql: Sql, adminId: string, hasher: string[]): Promise<void> {
  await sql`delete from admin_recovery_codes where admin_id = ${adminId}`;
  for (const h of hasher) {
    await sql`insert into admin_recovery_codes (admin_id, code_hash) values (${adminId}, ${h})`;
  }
}

/**
 * Merker koden brukt og sier om den var gyldig.
 *
 * `used_at is null` i where-setningen gjør at samme kode ikke kan
 * brukes to ganger, selv om to forespørsler kommer samtidig — det er
 * databasen som avgjør, ikke rekkefølgen på lesing og skriving.
 */
export async function brukReservekode(sql: Sql, adminId: string, kodeHash: string): Promise<boolean> {
  const r = await sql`
    update admin_recovery_codes set used_at = now()
    where admin_id = ${adminId} and code_hash = ${kodeHash} and used_at is null`;
  return r.count === 1;
}

export async function ubrukteReservekoder(sql: Sql, adminId: string): Promise<number> {
  const rows = await sql`
    select count(*)::int as n from admin_recovery_codes
    where admin_id = ${adminId} and used_at is null`;
  return rows[0]?.n ?? 0;
}

/* ------------------------------------------------------------------ *
 * Maskintokens
 * ------------------------------------------------------------------ */

export async function finnApiToken(
  sql: Sql,
  tokenHash: string,
): Promise<{ id: string; navn: string; rolle: Rolle } | null> {
  const rows = await sql`
    select id, name, role from admin_api_tokens
    where token_hash = ${tokenHash}
      and revoked_at is null
      and (expires_at is null or expires_at > now())
    limit 1`;
  const r = rows[0];
  if (!r) return null;
  await sql`update admin_api_tokens set last_used_at = now() where id = ${r.id}`;
  return { id: r.id, navn: r.name, rolle: r.role };
}
