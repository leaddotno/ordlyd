/**
 * Tester forseglingen som bærer innloggingen mellom passord og
 * engangskode, og reservekodene.
 *
 * Kjør:  pnpm exec tsx scripts/test-okt.mts
 */
import {
  forsegle, aapne, lagReservekoder, normaliserReservekode,
  settKapsel, slettKapsel, lesKapsler, nyHemmelighet,
} from "../apps/lisensserver/src/okt.js";
import { tolkQrKode } from "../apps/lisensserver/src/supabase-auth.js";

let feil = 0;
let n = 0;
const sjekk = (navn: string, ok: boolean, detalj?: unknown): void => {
  n++;
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${n}. ${navn}`);
  if (!ok && detalj !== undefined) console.log(`     ${JSON.stringify(detalj)}`);
};

const PEPPER = "test-pepper-som-ikke-brukes-i-produksjon";
const NAA = 1_800_000_000;

/* --- Vanlig rundtur --- */
const steg = {
  adminId: "b6ada369-be3b-4dd3-a114-e445efaf120e",
  accessToken: "eyJhbGciOiJIUzI1NiJ9.token",
  faktorId: "faktor-1",
  utfordringId: "utfordring-1",
  utloper: NAA + 600,
};
const segl = forsegle(PEPPER, steg);
sjekk("forseglingen kan åpnes igjen", JSON.stringify(aapne(PEPPER, segl, NAA)) === JSON.stringify(steg));
sjekk("forseglingen røper ikke tokenet", !segl.includes("token") && !segl.includes(steg.adminId));

/* --- DET KRITISKE: førstegangs oppsett har ingen faktor ennå --- */
const utenFaktor = {
  adminId: steg.adminId,
  accessToken: steg.accessToken,
  faktorId: "",
  utfordringId: "",
  utloper: NAA + 600,
};
const seglUtenFaktor = forsegle(PEPPER, utenFaktor);
sjekk(
  "FØRSTEGANGS OPPSETT: forsegling uten faktorId kan åpnes",
  aapne(PEPPER, seglUtenFaktor, NAA) !== null,
  aapne(PEPPER, seglUtenFaktor, NAA),
);

/* --- Avvisning --- */
sjekk("utløpt forsegling avvises", aapne(PEPPER, segl, NAA + 601) === null);
sjekk("feil pepper avvises", aapne(PEPPER + "x", segl, NAA) === null);
sjekk("tuklet forsegling avvises", aapne(PEPPER, segl.slice(0, -4) + "AAAA", NAA) === null);
sjekk("tomt tull avvises", aapne(PEPPER, "bare-tull", NAA) === null);
sjekk("forsegling uten adminId avvises", aapne(PEPPER, forsegle(PEPPER, { ...steg, adminId: "" }), NAA) === null);
sjekk("forsegling uten token avvises", aapne(PEPPER, forsegle(PEPPER, { ...steg, accessToken: "" }), NAA) === null);

/* --- Kapsler --- */
const k = settKapsel("__Host-test", "verdi123", 600);
sjekk("kapselen er HttpOnly", k.includes("HttpOnly"));
sjekk("kapselen er Secure", k.includes("Secure"));
sjekk("kapselen er SameSite=Strict", k.includes("SameSite=Strict"));
sjekk("kapselen har Path=/ som __Host- krever", k.includes("Path=/"));
sjekk("kapselen setter ingen Domain, som __Host- krever", !k.includes("Domain"));
sjekk("sletting setter Max-Age=0", slettKapsel("__Host-test").includes("Max-Age=0"));
sjekk(
  "lesKapsler finner flere kapsler",
  lesKapsler("__Host-a=1; __Host-b=2")["__Host-b"] === "2",
);
sjekk("lesKapsler tåler tom input", Object.keys(lesKapsler(undefined)).length === 0);

/* --- Hemmeligheter --- */
const h1 = nyHemmelighet();
sjekk("hemmeligheten er base64url uten utfylling", /^[A-Za-z0-9_-]{43}$/.test(h1), h1);
sjekk("to hemmeligheter er ulike", h1 !== nyHemmelighet());

/* --- Reservekoder --- */
const koder = lagReservekoder();
sjekk("ti reservekoder", koder.length === 10);
sjekk("formatet er fire grupper à fire", koder.every((k2) => /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(k2)), koder[0]);
sjekk("ingen forvekslingstegn (0 O 1 I L)", koder.every((k2) => !/[01OIL]/.test(k2)), koder.join(" "));
sjekk("alle ti er ulike", new Set(koder).size === 10);
sjekk("små bokstaver normaliseres", normaliserReservekode(koder[0].toLowerCase()) === koder[0]);
sjekk("manglende bindestreker normaliseres", normaliserReservekode(koder[0].replace(/-/g, "")) === koder[0]);
sjekk("mellomrom normaliseres", normaliserReservekode(koder[0].replace(/-/g, " ")) === koder[0]);

/* --- QR-koden fra Supabase, som er udokumentert og kan komme i flere former --- */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ffffff"/></svg>';

sjekk("rå SVG gjenkjennes", tolkQrKode(SVG).svg === SVG);
sjekk("XML-erklæring foran SVG gjenkjennes", tolkQrKode(`<?xml version="1.0"?>${SVG}`).svg.includes("<svg"));

/*
 * Fella som faktisk traff: rå SVG inne i en data-URI. Fargekoden
 * #ffffff gjør at nettleseren leser resten som et fragment og viser
 * ingenting — bildet blir tomt uten at noe feiler synlig.
 */
const raaUri = `data:image/svg+xml;utf-8,${SVG}`;
sjekk("RÅ SVG I DATA-URI pakkes ut framfor å gis til <img>", tolkQrKode(raaUri).svg === SVG, tolkQrKode(raaUri));
sjekk("og den gir ingen bilde-URI som inneholder #", tolkQrKode(raaUri).bilde === "");

const kodetUri = `data:image/svg+xml;utf-8,${encodeURIComponent(SVG)}`;
sjekk("URL-kodet SVG i data-URI pakkes ut", tolkQrKode(kodetUri).svg === SVG, tolkQrKode(kodetUri));

const b64Uri = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
sjekk("base64-SVG pakkes ut", tolkQrKode(b64Uri).svg === SVG);

const png = "data:image/png;base64,iVBORw0KGgo=";
sjekk("PNG beholdes som bilde-URI", tolkQrKode(png).bilde === png && tolkQrKode(png).svg === "");

sjekk("tom verdi gir tomt, ikke krasj", tolkQrKode("").svg === "" && tolkQrKode("").bilde === "");
sjekk("tull gir tomt, ikke krasj", tolkQrKode("bare tekst").svg === "" && tolkQrKode("bare tekst").bilde === "");
sjekk("ekstern URL avvises framfor å bryte innholdspolicyen", tolkQrKode("https://eksempel.no/qr.png").bilde === "");

console.log(feil === 0 ? `\nALLE ${n} OK` : `\n${feil} av ${n} FEILET`);
process.exit(feil === 0 ? 0 : 1);
