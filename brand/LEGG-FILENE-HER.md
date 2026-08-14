# Merkevarefiler for Ordlyd

Legg de to filene her. Byggetrinnet gjør resten — alle ikonstørrelser,
butikklogoen og logoen i utvidelsens paneler lages automatisk herfra.

## Filer som skal inn

| Filnavn | Hva | Krav |
|---|---|---|
| `ikon.png` | Appikonet (bokmerket med lydbølger) | **Kvadratisk**, minst 512×512, PNG, 8 bit per kanal, ikke interlaced |
| `logo.png` | Logoen med ordmerket | Vilkårlig bredde, PNG. Vises i 30 px høyde i popup og 44 px på Om-siden, så teksten bør være leselig ned til det |

## Valgfritt

| Filnavn | Hvorfor |
|---|---|
| `ikon-16.png` | Et detaljert merke blir grøt ved 16 piksler uansett hvor godt det skaleres. Legger du inn en håndtegnet 16×16, brukes den i stedet for nedskaleringen. 16 px er størrelsen folk faktisk ser i verktøylinja. |
| `ikon-32.png`, `ikon-48.png`, `ikon-128.png` | Samme prinsipp for de andre størrelsene |

## Hva som genereres

```
apps/extension/public/icons/icon-16.png     → utvidelsens ikon
apps/extension/public/icons/icon-32.png
apps/extension/public/icons/icon-48.png
apps/extension/public/icons/icon-128.png
apps/extension/public/brand/butikklogo-300.png  → til Partner Center
apps/extension/public/brand/logo.png            → popup og «Om Ordlyd»
```

Kjør på nytt etter en endring:

```bash
node scripts/build-icons.mjs
```

Det skjer også automatisk ved `pnpm --filter @ordlyd/extension build`.

## Mangler filene?

Da tegnes et plassholderikon, og bygget går videre med en tydelig advarsel.
Panelet viser navnet som tekst i stedet for logoen. Ingenting knekker — men
plassholderen skal ikke i butikken.
