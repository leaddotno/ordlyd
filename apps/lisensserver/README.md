# Skrivestøtte lisensserver

Vercel (Frankfurt) + Supabase Postgres (Frankfurt). Se `docs/lisensserver-plan.html`
for hele arkitekturen.

## Status

| Del | Status |
|---|---|
| `@skrivestotte/license-core` — kvitteringsformat, hashing, kodegenerering | ✅ 30 tester grønne |
| `src/logic.ts` — import, innlogging, fornyelse, stenging | ✅ testet mot MemoryDb |
| `src/db-postgres.ts` — Postgres mot Supabase | ✅ skrevet, ikke kjørt mot ekte base ennå |
| `api/` — Vercel-funksjoner | ✅ skrevet, venter på første deploy |
| `supabase/migrations/0001_init.sql` | ✅ klar til å kjøres |
| Superadmin-UI | ⬜ neste |

## Endepunkter

| Metode | Sti | Hva |
|---|---|---|
| GET | `/api/health` | Bekrefter database, nøkler og pepper. Første ting å åpne etter deploy. |
| GET | `/api/v1/keys` | Offentlig nøkkelsett (feilsøking — klienten pinner sine egne) |
| POST | `/api/v1/login` | `{email, code, product, version?}` → `{receipt, installId, installSecret}` |
| POST | `/api/v1/license/refresh` | `{installId, installSecret, product, version?}` → `{receipt}` |
| POST | `/api/v1/admin/import` | Bearer `ADMIN_TOKEN`. `{poolId, emails[]}` → lisenser med koder i klartekst (**engangs-eksport**) |
| POST | `/api/v1/admin/close` | Bearer `ADMIN_TOKEN`. `{entryId, reason?}` |
| GET | `/api/cron/cleanup` | Vercel Cron, kl. 03:17 daglig. Sletter innloggingsforsøk (>1 døgn) og nettnøkler (>30 dager). |

## Oppsett

### 1. Supabase (gjort)

Kjør migrasjonen: åpne SQL-editoren i prosjektet, lim inn hele
`supabase/migrations/0001_init.sql`, kjør. Sjekk etterpå at 12 tabeller finnes
og at RLS står på for alle.

Hent tilkoblingsstrengen under **Project Settings → Database → Connection string →
Transaction pooler** (port **6543**, ikke 5432 — se merknaden nederst).

### 2. Vercel

- Nytt prosjekt koblet til Git-repoet
- **Root Directory:** `apps/lisensserver`
- Framework preset: **Other**. Build command kan stå tom — det finnes ingen
  byggetrinn, bare serverless-funksjoner.
- Region settes av `vercel.json` (`fra1`)

### 3. Miljøvariabler (Vercel → Settings → Environment Variables)

| Variabel | Hvor den kommer fra |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler-streng (port 6543) |
| `LICENSE_PEPPER` | `openssl rand -base64 32` — genereres **én gang**. Byttes aldri uten migreringsplan: alle hasher blir ugyldige. |
| `SIGNING_KEYS_JWK` | Privat del fra `pnpm exec tsx scripts/generate-signing-keys.mts` |
| `ADMIN_TOKEN` | `openssl rand -base64 32` — midlertidig admin-autentisering |
| `CRON_SECRET` | `openssl rand -base64 32` — Vercel sender den som Bearer til cron-jobben |
| `MIN_VERSIONS` | Valgfri, f.eks. `{"edge-extension":"1.4.0"}` |
| `REVOKED_KIDS` | Valgfri, f.eks. `["sk-2025-11"]` |
| `ENDPOINTS_VERSION` | Valgfri, heltall |

Ingen av disse skal ligge i repoet. `.gitignore` blokkerer `.env*`, `*.jwk.json`
og `lisenser-*.csv`.

### 4. Første røyktest

```bash
curl https://<prosjektet>.vercel.app/api/health
```

Forventet: `{"ok":true,...,"sjekker":{"database":"ok","signingKey":"sk-…","pepper":"satt"}}`.
Står det `503`, sier `sjekker` hvilken av de tre som mangler.

## Sikkerhetsregler (planens kapittel 9)

- Klienten snakker **aldri** direkte med Supabase. Anon-nøkkelen brukes ikke i
  noen klient; radsikkerhet er på uten policyer, så bare service-rollen slipper til.
- Pepper og private nøkler bor hos Vercel, **aldri** i databasen. Da er en
  databaselekkasje ikke en lesbar medlemsliste.
- Rå IP lagres aldri — bare pseudonymiserte nettnøkler (/24 og /48) i aggregerte
  døgntall, slettet etter 30 dager.
- `/api/v1/login` svarer likt på feil kode og stengt konto, slik at endepunktet
  ikke kan brukes til å kartlegge hvilke adresser som finnes.

## Fallgruver som er håndtert i koden

- **Port 6543, ikke 5432.** Supabases pooler i transaksjonsmodus tåler ikke
  forberedte spørringer, derfor `prepare: false` i `db-postgres.ts`. Uten det
  feiler spørringer sporadisk når flere funksjonsinstanser deler backend.
- **Ratebegrensning før verifisering.** Ellers kan en angriper skille «feil kode»
  fra «for mange forsøk» og telle seg fram.
- **Fornyelse som avslås sletter ikke klientens kvittering.** Klienten beholder
  den til den utløper — det er hele offline-løftet.
