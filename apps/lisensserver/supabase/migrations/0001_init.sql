-- Ordlyd lisensserver — grunnskjema (Supabase / Postgres 15+)
--
-- Sikkerhetsmodell: ALL tilgang skjer via service-rollen fra Vercel-
-- funksjonene. Row Level Security er skrudd PÅ uten policyer, slik at
-- anon- og authenticated-rollene ikke ser noe som helst. Anon-nøkkelen
-- brukes aldri mot disse tabellene, og klienten snakker aldri direkte
-- med Supabase.
--
-- Personvern: e-poster og koder finnes bare som PEPREDE hasher (pepperet
-- bor i Vercels secret-lager, ikke her). Rå IP lagres aldri — bare en
-- pseudonymisert nettnøkkel per døgn for misbrukstellerne.

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  org_number text,
  status text not null default 'aktiv' check (status in ('aktiv', 'suspendert', 'avsluttet')),
  valid_to date,
  contact text,
  agreement_signed_on date,
  created_at timestamptz not null default now()
);

create table identity_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('code', 'feide', 'entra')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table license_pools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  status text not null default 'aktiv' check (status in ('aktiv', 'stengt')),
  valid_to date,
  -- {"edge-extension": {"features": ["tts", "ordbok", …]}} — kopieres inn i kvitteringen
  products jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Regelbaserte pooler tas i bruk med Feide-påbygget (planens P2)
create table pool_rules (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references license_pools(id) on delete cascade,
  rule jsonb not null,
  created_at timestamptz not null default now()
);

create table pool_entries (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references license_pools(id) on delete cascade,
  email_hash text not null,   -- HMAC(pepper, 'email:' + e-post), b64url
  email_masked text not null, -- "j***@domene.no" — kun visning i adminpanelet
  code_hash text not null,    -- HMAC(pepper, 'code:' + e-post + ':' + kode)
  status text not null default 'aktiv' check (status in ('aktiv', 'stengt')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pool_id, email_hash)
);
create index pool_entries_email_hash_idx on pool_entries (email_hash);

create table deny_entries (
  email_hash text primary key,
  reason text,
  created_at timestamptz not null default now()
);

create table installs (
  id uuid primary key,
  entry_id uuid not null references pool_entries(id) on delete cascade,
  secret_hash text not null,  -- HMAC(pepper, 'secret:' + installasjonshemmelighet)
  product text not null,
  version text,
  platform text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index installs_entry_idx on installs (entry_id);

-- Misbrukstellere: én rad per (lisens, døgn, nett). Antall ulike nett =
-- count(*) per (entry_id, day). Rå IP finnes ikke her.
create table usage_nets (
  entry_id uuid not null references pool_entries(id) on delete cascade,
  day date not null,
  net_hash text not null,     -- HMAC(pepper, 'net:' + /24- eller /48-prefiks)
  primary key (entry_id, day, net_hash)
);

create view usage_counters as
  select entry_id, day, count(*)::int as distinct_nets
  from usage_nets
  group by entry_id, day;

create table receipts (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references pool_entries(id) on delete set null,
  install_id uuid,
  kid text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null
);
create index receipts_entry_idx on receipts (entry_id, issued_at desc);

create table signing_keys (
  kid text primary key,
  status text not null default 'aktiv' check (status in ('aktiv', 'pensjonert', 'tilbakekalt')),
  ed25519_public_jwk jsonb not null,
  p256_public_jwk jsonb not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz
);

-- Ratebegrensning for innlogging. Ryddes av Vercel Cron (slett rader
-- eldre enn vinduet).
create table login_attempts (
  key text not null,          -- 'email:<hash>' eller 'net:<hash>'
  at timestamptz not null default now()
);
create index login_attempts_key_at_idx on login_attempts (key, at);

-- Append-only: API-et skriver, ingen oppdaterer eller sletter.
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  details jsonb
);

-- Steng alt for anon/authenticated: RLS på, ingen policyer.
alter table tenants enable row level security;
alter table identity_providers enable row level security;
alter table license_pools enable row level security;
alter table pool_rules enable row level security;
alter table pool_entries enable row level security;
alter table deny_entries enable row level security;
alter table installs enable row level security;
alter table usage_nets enable row level security;
alter table receipts enable row level security;
alter table signing_keys enable row level security;
alter table login_attempts enable row level security;
alter table audit_log enable row level security;
