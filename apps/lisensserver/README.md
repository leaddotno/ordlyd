# Skrivestøtte lisensserver

Vercel (EU-region) + Supabase Postgres (EU-region). Se `docs/lisensserver-plan.html`
for hele arkitekturen.

## Status

- ✅ `@skrivestotte/license-core`: kvitteringsformat (dobbel signatur Ed25519 + P-256),
  pepret hashing, kodegenerering — testet med `pnpm exec tsx scripts/test-license.mts`
- ✅ `src/logic.ts`: import → innlogging → fornyelse → stenging, testet mot MemoryDb
- ✅ `supabase/migrations/0001_init.sql`: komplett skjema med RLS stengt for alt
  unntatt service-rollen
- ⬜ Postgres-implementasjon av `Db` + Vercel-handlere (`api/`) — krever prosjektene under
- ⬜ Superadmin-UI

## Oppsett (gjøres én gang, av deg)

1. **Supabase**: opprett organisasjon + prosjekt, region **Frankfurt (eu-central-1)**.
   Kjør migrasjonen: lim inn `supabase/migrations/0001_init.sql` i SQL-editoren,
   eller `supabase db push` med CLI. Produksjon skal stå på betalt nivå
   (gratisnivået pauser inaktive prosjekter).
2. **Vercel**: opprett prosjekt koblet til dette repoet, rotkatalog
   `apps/lisensserver`, funksjonsregion **fra1 (Frankfurt)**.
3. **Secrets** (Vercel → Settings → Environment Variables):
   - `LICENSE_PEPPER` — 256-bits tilfeldig verdi. Genereres én gang; bytt ALDRI
     uten migreringsplan (alle hasher blir ugyldige).
   - `SIGNING_KEYS_JWK` — privat nøkkelsett fra `pnpm exec tsx scripts/generate-signing-keys.mts`
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — fra Supabase-prosjektet
4. Domenene fra L0 pekes mot Vercel når de er registrert.

## Sikkerhetsregler (fra planen, kapittel 9)

- Klienten (utvidelsen/PC-appen) snakker **aldri** direkte med Supabase — kun med
  vårt API. Anon-nøkkelen brukes ikke.
- Pepper og private nøkler bor hos Vercel, **aldri** i databasen.
- Rå IP lagres aldri — bare pseudonymiserte nettnøkler i aggregerte døgntall.
