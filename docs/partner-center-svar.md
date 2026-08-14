# Partner Center — svar på bakgrunnsspørsmålene

Alle svar er på engelsk, under 1000 tegn, og klare til å limes inn.

---

## Single purpose description

```
Ordlyd is assistive technology for people with dyslexia and other reading and writing difficulties who read and write Norwegian.

Its single purpose is to help the user read and write the text they are already working with in the browser. Every feature serves that one purpose: it reads selected text aloud with a Norwegian voice while highlighting the word being spoken, suggests words as the user types, corrects sound-based misspellings that ordinary spell checkers cannot match, reads back what the user has just written, and looks up words in the built-in Norwegian dictionaries.

All processing happens locally. The speech model, the dictionaries and the word lists are bundled in the extension and run through WebAssembly, so no page content is ever sent to a server and the extension works without an internet connection.
```

---

## offscreen justification

```
Speech synthesis runs locally through WebAssembly and needs both audio playback and a DOM. A Manifest V3 service worker has neither, so an offscreen document is the only way to synthesise and play the audio.

The offscreen document also keeps the Norwegian word bank and the two dictionaries in memory. Loading them takes a few seconds, and reloading them for every keystroke would make word suggestions unusable on the low-powered school laptops many of our users have.

We request the permission with the reasons AUDIO_PLAYBACK and DOM_PARSER. No offscreen document is created until the user actually uses a feature that needs it.
```

---

## storage justification

```
Stores the user's own settings locally: speech rate, colour theme, and which aids are switched on (word suggestions, spell checking, writing echo, dictionary box).

It also stores the signed licence receipt, a randomly generated installation identifier and a masked version of the user's e-mail address, so the extension can verify offline that it is licensed and show the user which account is active.

Everything is written to local extension storage. None of it is transmitted to us. We deliberately use chrome.storage.local rather than chrome.storage.sync, because sync is unreliable on the managed school devices many of our users have.
```

---

## alarms justification

```
Renews the signed licence receipt in the background, roughly once a day, so the user never has to log in again after the first activation.

chrome.alarms is necessary because a Manifest V3 service worker is terminated after a short idle period, and any setTimeout or setInterval is destroyed along with it. An alarm survives that and wakes the service worker at the scheduled time.

The alarm only triggers a small HTTPS request to our own licence server. It does not read or touch page content, and it does nothing when no licence is stored.
```

---

## Host permission justification

```
There are two separate needs here.

1. Our own licence server: https://lisens.ordlyd.no/*, https://lisens.ordlyd.lead.no/*, https://ordlyd-demo.vercel.app/*

The extension contacts these only to activate a licence and to renew it in the background. The two extra addresses are backup endpoints for the same service, so licence checks do not fail if one domain becomes unavailable. Manifest V3 requires host permissions to be declared at build time, which is why all three are listed rather than added later.

2. Content script on all sites

The core purpose is that the user can select text on any page and have it read aloud, and get writing help in any text field, so the content script has to run wherever the user reads and writes. It only reads the selection the user makes, places a small button next to it, and passes that text to the local speech engine. No page content leaves the machine and no browsing data is collected.
```

---

## Are you using remote code?

**No, I am not using remote code.**

Alt ligger i pakka. Ingen begrunnelse skal fylles ut.

---

## Om samme spørsmål dukker opp senere

Flytter vi stemmemodellen til CDN i versjon 1.1.0, er svaret **fortsatt nei**: reglene om
ekstern kode gjelder JavaScript og WebAssembly, og ONNX-modellvekter er *data*. WASM-en
blir liggende i pakka. Nevn nedlastingen i Notes for certification den gangen, så
gjennomgangen ikke stopper på det.
