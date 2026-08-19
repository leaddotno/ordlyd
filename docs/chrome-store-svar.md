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

---

## Testveiledning

Lisenskoden må lages først — se «Lag testlisensen» nederst. Bytt ut `XXX XXXX`.

Feltet er konfidensielt hos Google og vises ikke på oppføringen.

### Testkontolegitimasjon — engelsk (anbefalt)

```
Test account for review

E-mail:        chrome-review@ordlyd.no
Licence code:  XXX XXXX

How to activate:
1. Pin Ordlyd to the toolbar: click the puzzle-piece icon in Chrome, then the pin next to Ordlyd.
2. Click the Ordlyd icon to open the panel.
3. Enter the e-mail address and licence code above, then press Aktiver (Activate).

The account has every feature enabled and no expiry date.
It was created for the Chrome review and is not used by anyone else.

Note: the licence code is not a password to a web service. It only controls which
features the extension unlocks, and cannot be used to sign in anywhere else.

The interface is in Norwegian, as the extension is a Norwegian-language reading aid.
Aktiver = Activate. Innstillinger = Settings. Om Ordlyd = About Ordlyd.
```

### Testkontolegitimasjon — norsk

```
Testkonto for gjennomgang

E-post:      chrome-review@ordlyd.no
Lisenskode:  XXX XXXX

Slik aktiverer du:
1. Fest Ordlyd i verktøylinja: trykk puslespill-ikonet i Chrome og trykk nålen ved Ordlyd.
2. Trykk Ordlyd-ikonet for å åpne panelet.
3. Skriv inn e-postadressen og lisenskoden over, og trykk Aktiver.

Kontoen har alle funksjoner slått på og løper uten sluttdato.
Den er opprettet for Chrome-gjennomgangen og brukes ikke av andre.

Merk: lisenskoden er ikke et passord til en nettjeneste. Den kontrollerer bare
hvilke funksjoner utvidelsen låser opp, og den kan ikke brukes til å logge inn
noe annet sted.
```

### Ytterligere veiledning — engelsk (anbefalt), 440 tegn

```
Pin Ordlyd to the toolbar first (puzzle-piece icon, then the pin), otherwise it is hard to find.

After activation: select any text on any web page. A small button appears next to the selection — click it to have the text read aloud with a Norwegian voice.

The first playback takes a few seconds while the speech model loads locally. After that it is instant, and works offline.

Writing help appears on its own in text fields as you type.
```

### Ytterligere veiledning — norsk, 441 tegn

```
Fest Ordlyd i verktøylinja først (puslespill-ikonet → nålen), ellers er den vanskelig å finne.

Etter aktivering: marker tekst på en hvilken som helst nettside. En liten knapp dukker opp ved markeringen — trykk den for å få teksten lest opp med norsk stemme.

Første opplesing tar noen sekunder mens talemodellen lastes inn lokalt. Deretter er den umiddelbar, og virker uten nett.

Skrivehjelpen vises av seg selv i tekstfelt når du skriver.
```

### Hvorfor engelsk betyr mer her enn i de andre feltene

De andre svarene er påstander en gjennomgang kan kontrollere mot koden. Dette er en
*oppskrift* som skal følges. Klarer ikke den som gjennomgår å følge stegene, får hun ikke
verifisert kjernefunksjonen — og det er i seg selv en avvisningsgrunn.

Grensesnittet er dessuten på norsk. Den engelske versjonen har derfor en liten ordliste
til slutt (Aktiver, Innstillinger, Om Ordlyd), slik at hun finner knappene selv om hun
ikke leser norsk. Den detaljen er antakelig verdt mer enn resten av teksten.

### Lag testlisensen

I panelet på panel.ordlyd.no:

1. **Kunder og pooler** → fold ut kunden som ble brukt til Edge-sertifiseringen.
2. Trykk **Importer** på review-poolen.
3. Lim inn `chrome-review@ordlyd.no` og trykk **Importer og generer koder**.
4. Koden vises i tabellen. **Den vises bare én gang** — kopier den med én gang.

Koden er sju siffer og vises som `XXX XXXX`. Lim den inn slik den står; klienten tåler
mellomrommet.

Egen adresse for Chrome framfor å gjenbruke Edge-lisensen: da ser du i revisjonsloggen
hvilken butikks gjennomgang som er innom, og du kan stenge én av dem uten å røre den
andre.

---

## Vertstillatelse — revidert etter Googles forhåndsvarsel

Google varslet før innsending at brede vertstillatelser «kan kreve grundig
gjennomgang», og foreslo `activeTab` eller bestemte nettsteder. Det er ikke en
avvisning, men begrunnelsen bør svare direkte på forslaget framfor å la det stå
ubesvart. Bruk denne i stedet for versjonen lenger opp.

### Engelsk (anbefalt) — 944 tegn

```
1. Our own licence server (3 listed hosts) — contacted only to activate and renew a licence. Two of them are backup endpoints for the same service.

2. Content script on all sites

We evaluated activeTab and it cannot deliver the core function. Ordlyd is a reading aid for people with dyslexia. The central interaction is: the user selects text on any page, and a Read-aloud button appears next to the selection. That requires listening for selectionchange before the user acts. activeTab injects only after the user clicks our toolbar icon, so the button could never appear — the user would have to leave the text, find the toolbar and click. The writing aids have the same constraint: they listen for input events in text fields as the user types.

Listing specific sites is not possible either: pupils read and write wherever their school assigns.

The script only reads the user's selection. No page content, URL or title leaves the device.
```

### Norsk — 937 tegn

```
1. Vår egen lisensserver (de 3 oppførte vertene) — kontaktes bare for å aktivere og fornye lisens. To av dem er reservepunkter for samme tjeneste.

2. Innholdsskript på alle nettsteder

Vi har vurdert activeTab, og den kan ikke levere kjernefunksjonen. Ordlyd er et lesehjelpemiddel for personer med dysleksi. Den sentrale samhandlingen er: brukeren markerer tekst på en side, og en «Les opp»-knapp dukker opp ved markeringen. Det krever at vi lytter på selectionchange før brukeren gjør noe. activeTab injiserer først etter trykk på ikonet i verktøylinja, så knappen kunne aldri dukket opp — brukeren måtte forlatt teksten og trykket i verktøylinja. Skrivehjelpen har samme begrensning: den lytter på input i tekstfelt mens brukeren skriver.

Å liste bestemte nettsteder er heller ikke mulig: elever leser og skriver der skolen bestemmer.

Skriptet leser bare brukerens markering. Verken sideinnhold, URL eller tittel forlater maskinen.
```

### Hvorfor activeTab ikke er et alternativ

Innholdsskriptet lytter på `selectionchange`, `input`, `keydown` og `focusin`. Alle fire
krever at skriptet er **på plass før** brukeren gjør noe. `activeTab` injiserer først
etter at brukeren har trykket på ikonet i verktøylinja, og da er markeringen alt gjort.

Konsekvensen for de tre kjernefunksjonene:

| Funksjon | Med activeTab |
|---|---|
| «Les opp»-knapp ved markeringen | Umulig. Knappen kan ikke dukke opp før skriptet finnes. |
| Ordforslag og skriveekko i tekstfelt | Umulig. Krever at vi lytter mens brukeren skriver. |
| Ordbokoppslag | Ville virket, som eneste av de tre. |

For målgruppa er dette ikke en liten forskjell. Å markere tekst og få en knapp der du
allerede ser, mot å markere, flytte blikket og musa til verktøylinja, trykke, og finne
tilbake — det er nettopp den friksjonen et lesehjelpemiddel skal fjerne.

### Alternativet som faktisk finnes: valgfrie tillatelser

Det finnes en tredje vei vi bør bygge, men ikke i dag:
`optional_host_permissions` med `https://*/*`, ingen bred tillatelse i manifestet, og
`chrome.scripting.registerContentScripts()` etter at brukeren har sagt ja i vår egen
oppstartsskjerm.

- Fordel: rask gjennomgang for alltid etter, og brukeren velger selv — også per nettsted.
- Krever kode: deklarerte `content_scripts` kan ikke bruke valgfrie tillatelser, så
  registreringen må skje ved kjøring etter samtykket.
- **Den uavklarte risikoen:** på administrerte Chromebooker er det ikke sikkert at en
  skoleadministrator kan pre-godkjenne tillatelsen. `runtime_allowed_hosts` i
  ExtensionSettings styrer *blokkering*, og om den også *gir* en valgfri tillatelse er
  fortsatt et åpent spørsmål i W3C-arbeidsgruppa. Slår det ikke til, må hver elev klikke
  seg gjennom en tillatelsesdialog — og det er nettopp den gruppa som er minst rustet for
  det.

Derfor: send inn nå med den reviderte begrunnelsen, og gjør valgfrie tillatelser til en
undersøkelse før 1.1.0 — der første oppgave er å finne ut om skoleadministratorer faktisk
kan pre-godkjenne. Svaret på det avgjør om det er en forbedring eller en forverring.

