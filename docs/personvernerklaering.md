# Personvernerklæring for Ordlyd

**Sist oppdatert:** [DATO]

---

## Kort fortalt

- **Teksten du leser og skriver forlater aldri maskinen din.** Opplesing, ordbok,
  stavekontroll og ordforslag kjører lokalt i nettleseren.
- Vi lagrer **e-postadressen og lisenskoden din, begge kryptografisk omgjort**, slik at
  vi kan sjekke at du har gyldig lisens.
- Vi lagrer **ikke** navn, alder, klasse, diagnose, nettleserhistorikk eller hva du
  bruker Ordlyd til.
- Innstillingene dine ligger **bare i din egen nettleser**.
- Lisensopplysningene lagres i **EU (Frankfurt)**. Selve e-postutsendingen går
  gjennom en leverandør i **USA** — se punkt 6.

Resten av dokumentet forklarer dette presist.

---

## 1. Hvem er ansvarlig

**[ORGANISASJONSNAVN]**
Organisasjonsnummer: [ORG.NR.]
Postadresse: [POSTADRESSE]
E-post: [E-POSTADRESSE]

Vi er behandlingsansvarlig for personopplysningene som beskrives her.

**Ett viktig unntak:** Har du fått Ordlyd gjennom skolen, kommunen eller
fylkeskommunen din, er *de* behandlingsansvarlige, og vi er databehandler på deres
oppdrag. Da gjelder deres personvernerklæring i tillegg til denne, og vi behandler
opplysninger etter avtalen vi har med dem. Spørsmål om dine opplysninger rettes da
først til skoleeieren din.

---

## 2. Hva Ordlyd gjør på maskinen din — og hva som ikke sendes noe sted

Dette er det viktigste avsnittet i erklæringen, så vi sier det tydelig.

Ordlyd installeres som en utvidelse i nettleseren og har teknisk tilgang til
innholdet på nettsidene du besøker. Den tilgangen er nødvendig for at utvidelsen skal
kunne lese opp tekst du markerer og gi ordforslag i tekstfeltet du skriver i.

**Ingenting av dette innholdet sendes til oss.** Talesyntesen, ordboka,
stavekontrollen og ordforslagene ligger i selve utvidelsen og kjører på din egen
maskin. Ordlyd fungerer også helt uten internett, nettopp fordi ingen tekst behøver å
sendes noe sted for å bli behandlet.

Vi mottar altså ikke, og kan ikke se:

- teksten du leser eller får lest opp
- teksten du skriver
- hvilke nettsider du besøker
- hva du søker opp i ordboka

**Innstillingene dine** — om skriveekko er på, lesehastighet, tema, og om ordbokboksen
vises — lagres lokalt i nettleseren din og sendes ikke til oss.

**Lisensen din** lagres også lokalt: en signert lisenskvittering, en tilfeldig
installasjons-ID, en installasjonshemmelighet og en maskert versjon av e-postadressen
din, slik at popup-en kan vise hvilken konto som er aktivert.

---

## 3. Hvilke personopplysninger vi behandler

Ordlyd krever en lisenskode. For å administrere lisenser behandler vi følgende:

### 3.1 Om deg som bruker

| Opplysning | Hvordan den lagres | Hvorfor |
|---|---|---|
| E-postadressen din | Som **pepret hash** — en ikke-reverserbar kode laget med en hemmelig nøkkel som lagres et annet sted enn databasen | For å kjenne igjen deg ved innlogging og fornying |
| Prøveperiodens sluttdato | I klartekst, hvis du har en tidsbegrenset lisens | For å vite når lisensen går ut |
| Om du registrerte deg selv | I klartekst: «import» eller «selvregistrert» | For å skille lisenser vi har fått fra en organisasjon fra dem folk har hentet selv |
| Maskert e-postadresse, f.eks. `j***@skole.no` | I klartekst | For at du og den som administrerer lisensen skal kunne se hvilken konto det gjelder, uten at hele adressen ligger lagret |
| Lisenskoden din | Som **pepret hash** | For å kontrollere at koden er riktig |
| Lisensens status og når den sist ble brukt | I klartekst | For å kunne stenge misbrukte lisenser og se om en lisens er i bruk |

Vi ber deg aldri om, og registrerer aldri, navn, fødselsdato, klasse, skole,
diagnose eller andre helseopplysninger.

**Om lister fra foreninger:** Får du Ordlyd gjennom en forening for personer med
lese- og skrivevansker, er det foreningen som deler adressen din med oss, og som selv
er ansvarlig for å ha grunnlag for det. Vi lagrer adressen bare som hash og maskert
visning, og det er foreningen — ikke vi — som deler ut lisenskodene. Vi tar aldri
direkte kontakt med medlemmene.

### 3.2 Om installasjonene dine

| Opplysning | Hvorfor |
|---|---|
| En tilfeldig generert installasjons-ID | Skiller maskinene dine fra hverandre uten å identifisere maskinen |
| Hemmelighet for installasjonen, lagret som hash | Lar utvidelsen fornye lisensen i bakgrunnen uten at du logger inn på nytt |
| Hvilket produkt og hvilken versjon | Feilsøking og for å vite hvem som har gammel programvare |
| Når installasjonen sist var i kontakt | For å se hvor mange lisenser som faktisk er i bruk |

Vi lager **ikke** avtrykk av maskinvaren din — ingen maskinnavn, serienummer eller
disk-ID.

### 3.3 Tall for å oppdage misbruk av lisenser

Ordlyd deles ut gratis, og vi trenger å oppdage om en lisenskode blir spredt på
nettet. Til det lagrer vi, per lisens og per døgn:

- hvor mange installasjoner som er aktive
- hvor mange **ulike nettverk** kontakten kommer fra

Nettverket lagres som en **pseudonymisert kode**, laget av de første delene av
IP-adressen (de tre første tallgruppene for IPv4). **Vi lagrer ikke hele
IP-adressen din**, og koden kan ikke brukes til å finne tilbake til hvor du er.
Disse tallene slettes automatisk etter **30 dager**.

Er tallene uvanlig høye, blir lisensen markert for gjennomgang. **Ingen lisens stenges
automatisk** — et menneske vurderer den først.

### 3.4 Driftslogger og revisjonsspor

- **Revisjonsspor:** Vi loggfører administrative handlinger — at en lisens er
  opprettet, stengt eller gjenåpnet, og at en kvittering er utstedt. Loggen inneholder
  interne ID-er, ikke e-postadresser.
- **Innloggingsforsøk:** For å hindre at noen gjetter lisenskoder, teller vi forsøk
  per konto og per nettverk, begge som hash. Disse slettes etter **ett døgn**.
- **Leverandørenes driftslogger:** Våre leverandører (se punkt 6) fører alminnelige
  driftslogger over forespørsler til tjenesten, som normalt inkluderer IP-adresse.
  Disse ligger hos leverandøren og slettes etter deres rutiner. Vi bruker dem ikke til
  å følge enkeltbrukere.

---

### 3.5 Hvis du registrerer deg selv

Henter du en gratis prøvelisens på `lisens.ordlyd.no/registrer`, skjer dette:

- Du oppgir e-postadressen din. Vi lagrer den som hash og som maskert visning,
  akkurat som beskrevet over — ikke i lesbar form.
- Vi sender lisenskoden til adressen. Da går adressen gjennom Resend (punkt 6).
- Vi lagrer når prøveperioden går ut, og at lisensen ble hentet av deg selv.

Skriver du inn en adresse du ikke eier, får du ingenting: koden går til
innboksen, ikke til skjermen. Vi begrenser også hvor mange ganger samme adresse
kan registreres, slik at tjenesten ikke kan brukes til å sende uønsket e-post.

**Svaret på siden er alltid det samme,** enten adressen finnes hos oss eller
ikke. Det er med vilje: et svar som avslørte hvem som er registrert, ville i
praksis avslørt hvem som har lese- og skrivevansker.

Blir du senere lagt inn av skolen, kommunen eller en forening, flyttes lisensen
din dit automatisk — du beholder koden din, og prøveperioden slutter å gjelde.

## 4. Hvorfor vi behandler opplysningene, og med hvilket grunnlag

| Formål | Behandlingsgrunnlag |
|---|---|
| Gi deg tilgang til programvaren du har fått lisens til, og fornye lisensen automatisk | Oppfylle avtalen med deg, personvernforordningen artikkel 6 nr. 1 bokstav b |
| Sende deg lisenskoden når du selv ber om den | Oppfylle avtalen med deg, artikkel 6 nr. 1 bokstav b |
| Hindre gjetting av lisenskoder og oppdage koder som spres på nettet | Berettiget interesse i å beskytte tjenesten, artikkel 6 nr. 1 bokstav f |
| Kunne dokumentere hvem som har gjort hva med lisenser | Berettiget interesse i etterprøvbar drift, artikkel 6 nr. 1 bokstav f |
| Kundeforholdet med skoler, kommuner og foreninger | Oppfylle avtalen, artikkel 6 nr. 1 bokstav b. Der en offentlig skoleeier er ansvarlig, er grunnlaget deres utøvelse av offentlig myndighet, bokstav e |

Vi bruker ikke opplysningene til markedsføring, profilering eller automatiserte
avgjørelser som har rettsvirkning for deg.

---

## 5. Hvor lenge vi lagrer

| Opplysning | Lagringstid |
|---|---|
| Lisens (e-posthash, kodehash, maskert adresse, status) | Så lenge lisensen er aktiv, og deretter i **inntil 12 måneder** |
| Installasjoner | Slettes med lisensen, eller **12 måneder** etter siste kontakt |
| Pseudonymiserte nettverkskoder | **30 dager** |
| Innloggingsforsøk | **1 døgn** |
| Revisjonsspor og utstedte kvitteringer | **24 måneder** |
| Leverandørenes driftslogger | Etter leverandørens rutiner |

Slettingen skjer automatisk hvert døgn.

En løpende lisens uten sluttdato slettes ikke av seg selv — den er i bruk. Vil du at vi
skal slette den, ber du oss om det (se punkt 8).

---

## 6. Hvem som behandler opplysninger på vårt oppdrag

Vi bruker disse underleverandørene:

| Leverandør | Rolle | Hvor opplysningene ligger |
|---|---|---|
| Vercel Inc. | Drift av lisensserveren | EU — Frankfurt, Tyskland |
| Supabase Inc. | Database | EU — Frankfurt, Tyskland |
| Plus Five Five, Inc. («Resend») | Utsending av e-post | **USA** |

Vercel og Supabase er amerikanskeide, men opplysningene lagres i EU. Vi har
databehandleravtaler med alle tre, og overføringer utenfor EØS er regulert med
EU-kommisjonens standard avtalevilkår.

**Om e-postutsending — vi er tydelige på dette:** når vi sender deg lisenskoden,
går e-postadressen din og innholdet i meldingen gjennom Resend, som er
amerikansk. Resend oppgir selv at all kontodata, e-postmetadata og logger
lagres i USA, uavhengig av hvilken region e-posten sendes fra, og at data
beholdes i **30 dager**. Vi sender derfor aldri mer enn det som må til: adressen
din, lisenskoden og hvordan du kommer i gang. Ingen navn, ingen opplysninger om
bruk, og ingenting av teksten du leser eller skriver.

Vi selger aldri personopplysninger, og deler dem ikke med andre enn dette, med mindre
vi er rettslig forpliktet til det.

**Om distribusjon av utvidelsen:** Ordlyd distribueres gjennom Microsoft Edge
Add-ons. Microsoft behandler opplysninger om nedlasting og installasjon etter sin egen
personvernerklæring, uavhengig av oss.

Endrer vi underleverandør, oppdaterer vi denne listen.

---

## 7. Sikkerhet

Noen av tiltakene som beskytter opplysningene:

- **E-postadresser og lisenskoder finnes ikke i lesbar form** i databasen. De lagres
  som hash laget med en hemmelig nøkkel som ligger utenfor databasen, slik at en
  eventuell lekkasje fra databasen alene ikke gir en lesbar liste over brukere.
- **Lisenskoden din lagres aldri i klartekst noe sted.** Mister du koden, kan den ikke
  hentes fram igjen — du må få en ny. Det er en bevisst kostnad for å beskytte deg.
- Databasen er stengt for alt annet enn tjenestens egen tilgang.
- All kommunikasjon går kryptert over HTTPS.
- Lisensbeviset utvidelsen bruker er digitalt signert, og signaturen kontrolleres på
  din maskin. Det gjør at en falsk server ikke kan gi seg ut for å være oss.

---

## 8. Dine rettigheter

Du har rett til å:

- få innsyn i hvilke opplysninger vi har om deg
- få rettet opplysninger som er feil
- få slettet opplysninger
- få begrenset behandlingen
- protestere mot behandling som bygger på berettiget interesse
- få opplysningene overført til deg selv eller en annen (dataportabilitet)

Ta kontakt på [E-POSTADRESSE]. Vi svarer så raskt vi kan, og senest innen én måned.

**Om innsyn og sletting i praksis:** Fordi e-postadressen din bare finnes som hash,
finner vi opplysningene dine ved å regne ut hashen av adressen du oppgir. Vi trenger
derfor at du oppgir e-postadressen lisensen er registrert på.

Mener du at vi behandler opplysninger i strid med regelverket, kan du klage til
**Datatilsynet** — [datatilsynet.no](https://www.datatilsynet.no).

---

## 9. Barn og unge

Ordlyd brukes av elever, også under 15 år. Vi har innrettet tjenesten slik at det
samles inn så lite som mulig: ingen navn, ingen alder, ingen opplysninger om hva
eleven leser eller skriver, og ingen sporing på tvers av nettsteder.

Deles Ordlyd ut gjennom en skole eller kommune, er det skoleeieren som er ansvarlig
for behandlingen og for å informere elever og foresatte.

---

## 10. Informasjonskapsler

**Utvidelsen** bruker ikke informasjonskapsler. Den lagrer innstillinger og
lisensbevis lokalt i nettleseren din med nettleserens eget lagringsområde for
utvidelser.

**Dette nettstedet:** [Beskriv nettstedets egen bruk av informasjonskapsler her, eller
skriv at nettstedet ikke bruker informasjonskapsler ut over det som er strengt
nødvendig.]

---

## 11. Endringer

Vi kan oppdatere denne erklæringen. Datoen øverst viser når den sist ble endret. Ved
vesentlige endringer varsler vi de kundene vi har avtale med, og oppdaterer siden i
god tid før endringen får virkning.

---

## 12. Kreditering av innhold

Ordboka i Ordlyd bygger på åpne norske språkressurser:

- Bokmålsordboka og Nynorskordboka: © Universitetet i Bergen og Språkrådet
- Norsk ordbank: Språkbanken, CC-BY 4.0
- Talesyntese: Piper

---

# Til deg som skal publisere denne

Fyll inn før publisering:

| Plassholder | Hva |
|---|---|
| `[DATO]` | Dagens dato |
| `[ORGANISASJONSNAVN]` | Den juridiske enheten som er behandlingsansvarlig |
| `[ORG.NR.]` | Organisasjonsnummer |
| `[POSTADRESSE]` | Postadresse |
| `[E-POSTADRESSE]` | En adresse du faktisk leser — den brukes til innsynsforespørsler |
| Punkt 10, andre avsnitt | Nettstedets egen bruk av informasjonskapsler |

**Publiser den på `https://www.ordlyd.no/personvern`** — det er adressen som skal
oppgis som Privacy policy URL i Partner Center.

**Dette er ikke juridisk rådgivning.** Innholdet er nøyaktig i forhold til hva
programvaren faktisk gjør, men bør leses gjennom av noen med personvernkompetanse før
publisering — særlig punkt 4 om behandlingsgrunnlag og punkt 6 om
overføringsgrunnlag. Skal Telemark fylkeskommune være kunde, vil deres
personvernombud lese den uansett.

**Lagringstidene i punkt 5 er automatisert.** Alle seks periodene kjøres av den daglige
oppryddingen på serveren, og verdiene i koden er de samme som står i tabellen. Endrer du
en periode i erklæringen, må den endres i `apps/lisensserver/api/cron/cleanup.ts`
samtidig — ellers lover erklæringen noe systemet ikke gjør.

**Én ting jeg med vilje ikke automatiserte:** løpende lisenser uten sluttdato slettes
ikke av en tidsregel. Sletting utløses bare av en dato noen faktisk har satt på kunden
eller poolen. Alternativet — å slette lisenser det er «lenge siden noen brukte» — ville
før eller senere slettet lisensen til en elev som var borte et halvår.
