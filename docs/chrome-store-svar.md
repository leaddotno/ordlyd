# Chrome Nettmarked — svar på personvernspørsmålene

Norsk, alle under 1000 tegn, klare til å limes inn.
Engelske versjoner ligger i `partner-center-svar.md` — se merknaden nederst.

---

## Beskrivelse av enkeltformål

```
Ordlyd er et hjelpemiddel for personer med dysleksi og andre lese- og skrivevansker som leser og skriver norsk.

Enkeltformålet er å hjelpe brukeren med å lese og skrive den teksten hun allerede holder på med i nettleseren. Alle funksjonene tjener det ene formålet: utvidelsen leser opp markert tekst med norsk stemme og markerer ordet som blir lest, foreslår ord mens brukeren skriver, retter lydbaserte skrivefeil som vanlig stavekontroll ikke finner, leser tilbake det brukeren nettopp har skrevet, og slår opp ord i de innebygde norske ordbøkene.

All behandling skjer lokalt. Talemodellen, ordbøkene og ordlistene ligger i utvidelsen og kjører gjennom WebAssembly. Innholdet på sidene brukeren besøker sendes derfor aldri til en server, og utvidelsen virker uten internettforbindelse.
```

---

## Begrunnelse for offscreen

```
Talesyntesen kjører lokalt gjennom WebAssembly og trenger både lydavspilling og et DOM. En Manifest V3 service worker har ingen av delene, så et offscreen-dokument er den eneste måten å lage og spille av lyden på.

Offscreen-dokumentet holder også den norske ordbanken og de to ordbøkene i minnet. Å laste dem tar noen sekunder, og å laste dem på nytt for hvert tastetrykk ville gjort ordforslagene ubrukelige på de enkle skolemaskinene mange av brukerne våre har.

Vi ber om tillatelsen med begrunnelsene AUDIO_PLAYBACK og DOM_PARSER. Det opprettes ikke noe offscreen-dokument før brukeren faktisk tar i bruk en funksjon som trenger det.
```

---

## Begrunnelse for storage

```
Lagrer brukerens egne innstillinger lokalt: opplesingshastighet, fargetema og hvilke hjelpemidler som er slått på (ordforslag, stavekontroll, skriveekko, ordbokboks).

Lagrer også den signerte lisenskvitteringen, en tilfeldig generert installasjons-ID og en maskert versjon av brukerens e-postadresse, slik at utvidelsen kan kontrollere uten nett at den har gyldig lisens, og vise brukeren hvilken konto som er aktiv.

Alt skrives til lokal lagring i utvidelsen. Ingenting av det overføres til oss. Vi bruker med vilje chrome.storage.local og ikke chrome.storage.sync, fordi sync er upålitelig på de administrerte skolemaskinene mange av brukerne våre har.
```

---

## Begrunnelse for alarms

```
Fornyer den signerte lisenskvitteringen i bakgrunnen, omtrent én gang i døgnet, slik at brukeren aldri trenger å logge inn igjen etter første aktivering.

chrome.alarms er nødvendig fordi en Manifest V3 service worker avsluttes etter kort tid uten aktivitet, og enhver setTimeout eller setInterval forsvinner sammen med den. En alarm overlever dette og vekker service workeren på avtalt tid.

Alarmen utløser bare en liten HTTPS-forespørsel til vår egen lisensserver. Den leser ikke og rører ikke innholdet på sidene, og den gjør ingenting når det ikke er lagret noen lisens.
```

---

## Begrunnelse for vertstillatelse

```
Det er to ulike behov her.

1. Vår egen lisensserver: https://lisens.ordlyd.no/*, https://lisens.ordlyd.lead.no/*, https://ordlyd-demo.vercel.app/*

Utvidelsen kontakter disse bare for å aktivere en lisens og fornye den i bakgrunnen. De to ekstra adressene er reservepunkter for samme tjeneste, slik at lisenskontrollen ikke feiler om ett domene blir utilgjengelig. Manifest V3 krever at vertstillatelser oppgis ved bygging, derfor står alle tre oppført.

2. Innholdsskript på alle nettsteder

Kjerneformålet er at brukeren skal kunne markere tekst på hvilken som helst side og få den lest opp, og få skrivehjelp i hvilket som helst tekstfelt. Innholdsskriptet må derfor kunne kjøre der brukeren leser og skriver. Det leser bare markeringen brukeren selv gjør, plasserer en liten knapp ved den, og sender teksten til den lokale talemotoren. Ingenting av sideinnholdet forlater maskinen, og det samles ikke inn nettleserdata.
```

---

## Bruker du ekstern kode?

**Nei, jeg bruker ikke ekstern kode.**

Ingen begrunnelse skal fylles ut. Alt ligger i pakken, og innholdspolicyen i manifestet
er `script-src 'self' 'wasm-unsafe-eval'`.

---

## To merknader

**Om språk.** Chrome viser skjemaet på norsk fordi kontoen din er norsk, men de som
leser svarene er Googles egne gjennomgangsteam. De engelske versjonene i
`partner-center-svar.md` er de samme svarene, og de er allerede godtatt av Microsoft.
Vil du redusere sjansen for spørsmål tilbake, er engelsk det tryggere valget — særlig
på `<all_urls>`, som er punktet de ser nøyest på.

**Om ekstern kode senere.** Flytter vi talemodellen og ordbøkene til CDN i en senere
versjon, er svaret **fortsatt nei**: reglene om ekstern kode gjelder JavaScript og
WebAssembly, og ONNX-modellvekter og ordlister er *data*. WASM-en må da bli liggende i
pakken — flyttes den ut, blir svaret ja, og hele gjennomgangen blir en annen sak.
Nevn nedlastingen i notatene til sertifiseringen den gangen.

---

## Databruk — hvilke bokser som skal krysses

Verifisert mot koden, ikke mot hukommelsen. Utvidelsen sender bare tre slags
forespørsler, og bare til vår egen lisensserver:

| Kall | Innhold |
|---|---|
| Aktivering | e-postadresse, lisenskode, produkt, versjon |
| Fornying (daglig) | installasjons-ID, installasjonshemmelighet, produkt, versjon |
| Versjonssjekk | bare produktnavnet |

Serveren mottar i tillegg IP-adressen, som enhver HTTPS-forespørsel gjør, og lagrer
en pepret hash av de tre første tallgruppene i 30 dager til misbrukstelling.

Ingen `fetch` i utvidelsen går noe annet sted enn til filer inne i pakken
(`chrome.runtime.getURL`). Verken URL, sidetittel eller markert tekst forlater
maskinen noen gang.

### Kryss av

| Kategori | Kryss | Hvorfor |
|---|---|---|
| Personlig identifiserende informasjon | **JA** | E-postadressen sendes ved aktivering. |
| Autentiseringsinformasjon | **JA** | Lisenskoden og installasjonshemmeligheten er legitimasjon. |
| Posisjon | **JA** | IP-adresse står eksplisitt som eksempel, og vi lagrer en hash avledet av den. |
| Helseinformasjon | nei | Vi spør ikke om og sender ikke diagnose, symptomer eller historikk. |
| Økonomisk informasjon | nei | Ingen betaling skjer i utvidelsen. |
| Personlig kommunikasjon | nei | Markert tekst leses lokalt og sendes aldri. |
| Nettlogg | nei | Vi leser aldri URL eller sidetittel. |
| Brukeraktivitet | nei | Tastetrykk behandles lokalt for ordforslag, aldri overført. |
| Innhold på nettsteder | nei | Behandles lokalt av talemotoren, aldri overført. |

Alle tre sertifiseringene nederst kan krysses: vi selger ikke og overfører ikke
brukerdata, bruker dem ikke til noe utenfor enkeltformålet, og bruker dem ikke til
kredittvurdering.

### Om helseinformasjon — og hvorfor det ikke er selvmotsigende

Jeg har tidligere skrevet at Ordlyd behandler *helseopplysninger etter
personvernforordningen artikkel 9*. Det står fortsatt. De to svarene handler om ulike
spørsmål:

- **GDPR** spør hva som kan *utledes*. At noen har lisens på et dyslektikerhjelpemiddel
  antyder en lese- og skrivevanske, og derfor behandler vi lista med den forsiktigheten
  særlige kategorier krever.
- **Chrome** spør hva du *samler inn*, med konkrete eksempler: pulsdata, medisinsk
  historikk, symptomer, diagnoser, prosedyrer. Ingen av dem finnes i systemet vårt.

Å krysse Helseinformasjon ville dessuten stått offentlig på oppføringen som «denne
utvidelsen samler inn helseopplysninger». Det er ikke sant, og for et verktøy rettet mot
en sårbar gruppe er det en påstand som skremmer folk bort fra noe de har rett på.

### Om posisjon — en vurdering, ikke en fasit

Her er det rom for skjønn. Vi bruker ikke IP til å finne ut *hvor* noen er, og vi lagrer
aldri hele adressen. Men Google lister «IP-adresse» eksplisitt som eksempel i den
kategorien, og vi gjør mer enn å motta den i en logg: vi regner ut og lagrer en verdi
avledet av den, i 30 dager.

Argumentet for å la den stå åpen er at vi ikke driver stedfesting. Argumentet for å
krysse er at underrapportering er den feilen som får en utvidelse fjernet, mens
overrapportering bare krever en forklaring. Jeg anbefaler å krysse, og å la
personvernerklæringen forklare hva vi faktisk gjør — den beskriver alt dette fra før.
