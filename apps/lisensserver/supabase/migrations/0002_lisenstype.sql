-- Lisenstype på poolen, slik at «Om Ordlyd» kan forklare NØYAKTIG den
-- lisensen brukeren har — ikke bare lisenser i sin alminnelighet.
--
-- Typen følger med i kvitteringen, så klienten kjenner den også offline.
--
-- Standardverdien er 'apen': en pool som ikke har fått en type satt er
-- fritt utdelt programvare, som er utgangspunktet vårt. Superadmin velger
-- eksplisitt for kunder som har en annen ordning.

alter table license_pools
  add column plan text not null default 'apen'
  check (plan in ('medlem', 'skole', 'prove', 'apen'));

comment on column license_pools.plan is
  'medlem = via forening, skole = kommune/fylke, prove = tidsbegrenset, apen = fritt utdelt';
