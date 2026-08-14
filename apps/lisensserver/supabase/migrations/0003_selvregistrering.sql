-- Selvregistrering av prøvelisenser.
--
-- Tre endringer:
--
--  1. `valid_to` på den enkelte lisensen. Prøveperioden løper 60 dager fra
--     HVER registrering, ikke fra en felles dato på poolen. Uten dette
--     måtte alle prøvebrukere delt samme sluttdato.
--
--  2. `app_settings` — innstillinger som skal kunne endres i drift, uten
--     ny utrulling. Prøvelengden og om fornyelse er tillatt er nettopp
--     avgjørelser som endrer seg over tid.
--
--  3. Prøvekunden og prøvepoolen, med id-en lagret i app_settings, slik at
--     registreringsendepunktet finner den uten å ha den hardkodet.

alter table pool_entries
  add column valid_to date,
  add column source text not null default 'import'
    check (source in ('import', 'selvregistrert'));

comment on column pool_entries.valid_to is
  'Sluttdato for denne ene lisensen. NULL = følger poolens og kundens datoer.';
comment on column pool_entries.source is
  'import = lagt inn av superadmin, selvregistrert = brukeren registrerte seg selv';

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

insert into app_settings (key, value) values
  ('registrering_apen',       'true'::jsonb),
  ('prove_dager',             '60'::jsonb),
  ('prove_fornyelse_tillatt', 'true'::jsonb)
on conflict (key) do nothing;

-- Prøvekunde
insert into tenants (slug, name, status)
values ('ordlyd-prove', 'Ordlyd prøvelisenser', 'aktiv')
on conflict (slug) do nothing;

-- Prøvepool. Poolen selv er løpende; det er den enkelte lisensen som utløper.
insert into license_pools (tenant_id, name, status, plan, products)
select
  t.id, 'Prøvelisens', 'aktiv', 'prove',
  '{"edge-extension": {"features": ["tts", "ordbok", "stavekontroll", "prediksjon", "skriveekko"]}}'::jsonb
from tenants t
where t.slug = 'ordlyd-prove'
  and not exists (
    select 1 from license_pools p where p.tenant_id = t.id and p.name = 'Prøvelisens'
  );

-- Registreringsendepunktet leser denne i stedet for å ha id-en hardkodet.
insert into app_settings (key, value)
select 'prove_pool_id', to_jsonb(p.id::text)
from license_pools p
join tenants t on t.id = p.tenant_id
where t.slug = 'ordlyd-prove' and p.name = 'Prøvelisens'
on conflict (key) do nothing;

-- Bekreftelse: skal vise prøvepoolens id og de fire innstillingene.
select key, value from app_settings order by key;
