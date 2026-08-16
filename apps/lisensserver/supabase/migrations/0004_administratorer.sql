-- Administratorkontoer med roller, økter og reservekoder.
--
-- Selve kontoen — passord og TOTP-faktor — bor i Supabase Auth
-- (auth.users). Denne migrasjonen legger til det Supabase ikke har:
-- hvem personen er hos oss, hvilken rolle hun har, hvilke kunder hun
-- eventuelt er avgrenset til, våre egne økter, og reservekoder for
-- TOTP.
--
-- Hvorfor våre egne økter når Supabase utsteder tokens: fordi en rad vi
-- eier kan rives i samme sekund en tilgang trekkes tilbake. Et JWT må
-- vente til det utløper. Det er også grunnen til at «session timeouts»
-- og «single session per user» — som er Pro-funksjoner hos Supabase —
-- ikke er noe vi trenger å betale for.
--
-- MERK om personvern: e-postadressen til en administrator lagres i
-- KLARTEKST, i motsetning til sluttbrukernes. Det er en bevisst og
-- nødvendig forskjell: administratorer er identifiserte medarbeidere som
-- må kunne motta e-post om kontoen sin, og opplysningen er ikke i
-- kategorien etter artikkel 9. Personvernerklæringen må presiseres
-- tilsvarende — se planens kapittel 13.

-- Alt er skrevet med «if not exists» slik at skriptet kan kjøres på nytt
-- uten å feile. Supabase kjører hele skriptet i én transaksjon: feiler
-- én linje, rulles ALT tilbake — også det som så ut til å gå bra.

create table if not exists admins (
  -- Samme id som i Supabase Auth. Fremmednøkkelen legges til i et eget
  -- steg lenger nede, fordi den krever rettigheter i auth-skjemaet som
  -- ikke alltid finnes. Den er en bekvemmelighet (kaskadesletting), ikke
  -- en forutsetning — så den skal ikke få velte hele migrasjonen.
  id            uuid primary key,
  email         text not null unique,
  name          text not null,
  role          text not null check (role in ('eier','forvalter','kundeadmin','revisor')),
  status        text not null default 'aktiv' check (status in ('aktiv','sperret')),
  -- Settes false bare for revisor, som er den ene rollen uten totrinnskrav.
  krev_totrinn  boolean not null default true,
  created_by    uuid references admins(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

comment on table admins is
  'Administratorer. Rolle og identitet hos oss; passord og TOTP ligger i auth.users.';
comment on column admins.email is
  'Klartekst, i motsetning til sluttbrukernes. Identifisert medarbeider, ikke art. 9-opplysning.';

-- Ingen rader = alle kunder, og det er BARE lovlig for eier og forvalter.
-- For kundeadmin og revisor er dette hele tilgangen, og minst én rad kreves.
-- Regelen håndheves i applikasjonen (tilgang.ts), ikke her, fordi den
-- avhenger av rollen i en annen tabell.
create table if not exists admin_scopes (
  admin_id  uuid not null references admins(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  primary key (admin_id, tenant_id)
);
create index if not exists admin_scopes_tenant_idx on admin_scopes (tenant_id);

create table if not exists admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admins(id) on delete cascade,
  -- HMAC(pepper, 'okt:' + token). Selve tokenet finnes bare i kapselen.
  token_hash   text not null unique,
  -- aal1 = bare passord, aal2 = passord + totrinn. Rollene som krever
  -- totrinn slippes ikke inn på aal1.
  aal          text not null check (aal in ('aal1','aal2')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  -- Pseudonymisert nett, som ellers i systemet. Rå IP lagres aldri.
  net_hash     text,
  -- ISO 3166-1, fra Vercels x-vercel-ip-country. Kun til visning i
  -- «dine økter» og til forarbeidet for landsperren (planens kap. 09).
  land         text
);
create index if not exists admin_sessions_admin_idx on admin_sessions (admin_id, created_at desc);
create index if not exists admin_sessions_expires_idx on admin_sessions (expires_at);

-- Supabase Auth utsteder ikke reservekoder for TOTP. Uten dem betyr en
-- mistet telefon at nødinngangen må brukes hver gang.
-- Samme mønster som engangs-eksporten ved medlemsimport: vist én gang,
-- lagret bare som pepret hash.
create table if not exists admin_recovery_codes (
  admin_id   uuid not null references admins(id) on delete cascade,
  code_hash  text not null,          -- HMAC(pepper, 'recovery:' + kode)
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (admin_id, code_hash)
);

-- Maskiner og skript. Erstatter ADMIN_TOKEN for røyktestene, slik at én
-- automatisering kan miste tilgangen uten at menneskene rammes.
create table if not exists admin_api_tokens (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,        -- «røyktest», «importskript hos DN»
  token_hash   text not null unique, -- HMAC(pepper, 'apitoken:' + token)
  role         text not null check (role in ('forvalter','revisor')),
  created_by   uuid references admins(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);

-- Steng for anon/authenticated: RLS på, ingen policyer. All tilgang går
-- gjennom service-rollen fra Vercel-funksjonene, som ellers i skjemaet.
alter table admins               enable row level security;
alter table admin_scopes         enable row level security;
alter table admin_sessions       enable row level security;
alter table admin_recovery_codes enable row level security;
alter table admin_api_tokens     enable row level security;

-- ---------------------------------------------------------------------
-- Revisjonsloggen får identitet OG kundetilhørighet.
--
-- actor beholdes som visningsnavn. Gamle linjer med 'superadmin' blir
-- stående som de er — vi later ikke som om vi vet hvem det var.
--
-- tenant_id er det som gjør at en revisor kan se sine egne kunders
-- linjer og ingen andres. Uten den måtte filtreringen grave i
-- details-jsonb, og «revisor ser bare sitt» ville vært gjetting.
-- NULL betyr global handling (innstillinger, administrasjon av
-- administratorer) og er synlig bare for eier og forvalter.
-- ---------------------------------------------------------------------
alter table audit_log
  add column if not exists actor_id   uuid,
  add column if not exists actor_kind text not null default 'system',
  add column if not exists tenant_id  uuid references tenants(id) on delete set null;

-- Sjekken legges til separat, slik at et gjentatt kjør ikke feiler på at
-- den finnes fra før.
do $$
begin
  alter table audit_log add constraint audit_log_actor_kind_sjekk
    check (actor_kind in ('admin','apitoken','system','cron','bootstrap'));
exception
  when duplicate_object then null;
end $$;

-- Kaskadesletting fra Supabase Auth. Krever rettigheter i auth-skjemaet,
-- og er en bekvemmelighet framfor en forutsetning: uten den blir en
-- slettet Supabase-bruker stående igjen som en rad her, som eier da må
-- rydde manuelt. Feiler den, skal ikke resten av migrasjonen ryke.
do $$
begin
  alter table admins add constraint admins_auth_bruker
    foreign key (id) references auth.users(id) on delete cascade;
  raise notice 'Fremmednøkkel mot auth.users lagt til.';
exception
  when duplicate_object then null;
  when others then
    raise notice 'Kunne IKKE knytte admins til auth.users (%). Alt annet virker; slettede Supabase-brukere må ryddes manuelt.', sqlerrm;
end $$;

comment on column audit_log.actor_kind is
  'bootstrap = nødinngangen. Hver slik linje skal ha utløst e-post til alle eiere.';

create index if not exists audit_log_at_idx     on audit_log (at desc);
create index if not exists audit_log_actor_idx  on audit_log (actor_id, at desc);
create index if not exists audit_log_tenant_idx on audit_log (tenant_id, at desc);

-- Bekreftelse: skal vise fem nye tabeller og tre nye kolonner på audit_log.
select 'tabell' as hva, table_name as navn
from information_schema.tables
where table_schema = 'public'
  and table_name in ('admins','admin_scopes','admin_sessions',
                     'admin_recovery_codes','admin_api_tokens')
union all
select 'audit_log-kolonne', column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'audit_log'
  and column_name in ('actor_id','actor_kind','tenant_id')
order by hva, navn;
