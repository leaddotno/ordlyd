-- Oppretter en TESTKUNDE med én pool, slik at ende-til-ende-testen
-- (scripts/smoke-lisensserver.mts) har noe å importere lisenser til.
--
-- Alt her kan slettes trygt etterpå med:
--     delete from tenants where slug = 'test-kunde';
-- Sletting kaskaderer til pool, lisenser, installasjoner og kvitteringer.

insert into tenants (slug, name, status)
values ('test-kunde', 'TEST — kan slettes', 'aktiv')
on conflict (slug) do nothing;

insert into license_pools (tenant_id, name, status, products)
select
  t.id,
  'Testpool',
  'aktiv',
  '{"edge-extension": {"features": ["tts", "ordbok", "stavekontroll", "prediksjon"]}}'::jsonb
from tenants t
where t.slug = 'test-kunde'
  and not exists (
    select 1 from license_pools p where p.tenant_id = t.id and p.name = 'Testpool'
  );

-- Kopier verdien i pool_id inn i miljøvariabelen ORDLYD_TEST_POOL_ID.
select
  p.id   as pool_id,
  t.slug as kunde,
  p.name as pool
from license_pools p
join tenants t on t.id = p.tenant_id
where t.slug = 'test-kunde';
