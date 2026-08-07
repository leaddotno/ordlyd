# Skrivestøtte

Lese- og skrivestøtte for nettleseren (Edge/Chrome) — erstatning for IntoWords/Lingdys.
All prosessering skjer lokalt hos brukeren: tekst-til-tale med Piper (WebAssembly),
senere ordprediksjon og dysleksitilpasset stavekontroll.

## Struktur

| Mappe | Innhold |
|---|---|
| `packages/tts` | TTS-motor: Piper i nettleseren, setningsdeling, ord-tidsestimat, avspillingskontroller |
| `packages/writing-engine` | Skrivestøtte: ordprediksjon (frekvensrangert prefiks-fullføring) + forslags-panel ved skrivemarkøren |
| `apps/demo` | Testside: syntese + ordmarkering + skrivestøtte |
| `apps/extension` | Edge-utvidelse (MV3): opplesing av markert tekst, ordforslag i tekstfelt, innstillinger (popup) |

## Kom i gang

```bash
pnpm install
pnpm setup-assets    # laster ned stemmen (én gang, ~63 MB) og kopierer WASM
pnpm demo            # testside på http://localhost:5173
```

Bygg utvidelsen:

```bash
pnpm --filter @skrivestotte/extension build
```

Last inn `apps/extension/dist` som «unpacked extension» i edge://extensions (utviklermodus).

## Offline-drift

Stemmen (`no_NO-talesyntese-medium`) og all WebAssembly (onnxruntime, piper_phonemize)
pakkes inn i utvidelsen (~98 MB). Etter installasjon trengs **ingen internettilgang** —
verifisert ved at nettverksloggen kun viser lokale forespørsler under opplesing.

## Status

- Spike S1 (Piper norsk stemme i WASM): godkjent — 410 ms varm latens til lydstart.
- Spike S2 (ordmarkering synkront med lyd): godkjent.
- Edge-utvidelse: marker tekst → flytende knapp → opplesing med ordmarkering. Helt offline.
- Innstillinger (popup): hovedbryter av/på, hastighet, ordforslag av/på. Lagres i chrome.storage.sync.
- Ordforslag: 120 000 norske ord (frekvensliste fra OpenSubtitles/HermitDave — byttes til
  Norsk ordbank + Språkbanken i full fase 4). Panel ved markøren i textarea/input/contenteditable;
  piltaster + Tab/Enter, tallmerking 1–5, klikk. Kjøres 100 % lokalt.
- Neste: fase 2 (lisens/kundesystem), spike S3 (Google Docs), dysleksitilpasset stavekontroll (NST).
