# Skrivestøtte

Lese- og skrivestøtte for nettleseren (Edge/Chrome) — erstatning for IntoWords/Lingdys.
All prosessering skjer lokalt hos brukeren: tekst-til-tale med Piper (WebAssembly),
senere ordprediksjon og dysleksitilpasset stavekontroll.

## Struktur

| Mappe | Innhold |
|---|---|
| `packages/tts` | TTS-motor: Piper i nettleseren, setningsdeling, ord-tidsestimat, avspillingskontroller |
| `apps/demo` | Testside for spike S1/S2: syntese + ordmarkering synkront med lyd |
| `apps/extension` | Edge-utvidelse (MV3): marker tekst → opplesing med ordmarkering |

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
- Neste: fase 2 (lisens/kundesystem) og spike S3 (Google Docs).
