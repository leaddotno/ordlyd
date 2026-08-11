/**
 * Bygger den innebygde ordboka (assets/dict/ordbok/) fra UiB/Språkrådets
 * åpne dumper av Bokmålsordboka og Nynorskordboka (https://ord.uib.no/).
 * Lisens: fri bruk med kreditering av UiB og Språkrådet.
 *
 * Resultatformat (per målform bm/nn):
 *   index/xx.json   ordform (også bøyd) → [artikkel-id-er]   (256 shards, hash av ord)
 *   art/xx.json     artikkel-id → kompakt artikkel           (256 shards, id % 256)
 *
 * Kompakt artikkel: { w: [oppslagsord], k: ordklasse, b: [bøyningsformer], d: [definisjoner] }
 * Definisjon:       { t: tekst, e: [eksempler], u: [underdefinisjoner] }
 *
 * Sharding gjør at oppslag kun laster ~150 kB ved behov — ingenting holdes
 * i minne, viktig for svake skole-PC-er.
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "assets", "raw");
const OUT = join(ROOT, "assets", "dict", "ordbok");
const LANGS = ["bm", "nn"];
const MAX_IDS_PER_FORM = 8;
const MAX_FORMS_SHOWN = 14;

/** MÅ være identisk med shardOf i packages/writing-engine/src/dictionary.ts */
function shardOf(word) {
  let h = 5381;
  for (let i = 0; i < word.length; i++) h = ((h * 33) ^ word.charCodeAt(i)) >>> 0;
  return (h & 0xff).toString(16).padStart(2, "0");
}

async function download(url, dest) {
  if (existsSync(dest)) return;
  console.log(`⬇ ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/* ---------- Rendering av UiB-strukturen til ren tekst ---------- */

/** Erstatt $-plassholdere i content med tekst fra items */
function resolveContent(content, items = []) {
  let i = 0;
  const text = (content ?? "").replace(/\$/g, () => renderItem(items[i++]));
  return text.replace(/\s+/g, " ").trim();
}

function renderItem(item) {
  if (!item) return "";
  switch (item.type_) {
    case "usage":
      return item.text ?? resolveContent(item.content, item.items);
    case "article_ref":
      return item.word_form ?? item.lemmas?.[0]?.lemma ?? "";
    case "entity":
      return String(item.id ?? "");
    case "superscript":
    case "subscript":
      return item.text ?? "";
    case "quote_inset":
    case "explanation":
      return resolveContent(item.content, item.items);
    case "fraction":
      return `${item.numerator}/${item.denominator}`;
    default:
      return item.text ?? item.lemma ?? (item.content ? resolveContent(item.content, item.items) : "");
  }
}

/** Render én definisjonsnode rekursivt → { t, e, u } */
function renderDefinition(def) {
  const out = { t: "", e: [], u: [] };
  for (const el of def.elements ?? []) {
    switch (el.type_) {
      case "explanation": {
        const text = resolveContent(el.content, el.items);
        if (text) out.t = out.t ? `${out.t}; ${text}` : text;
        break;
      }
      case "example": {
        const q = resolveContent(el.quote?.content, el.quote?.items);
        const ex = resolveContent(el.explanation?.content, el.explanation?.items);
        if (q) out.e.push(ex ? `${q} (${ex})` : q);
        break;
      }
      case "definition": {
        const sub = renderDefinition(el);
        if (sub.t || sub.e?.length || sub.u?.length) out.u.push(sub);
        break;
      }
      case "sub_article": {
        // Faste uttrykk («beløpe seg til») med egne definisjoner
        const lemmas = (el.article?.lemmas ?? []).map((l) => l.lemma).join(", ") || el.lemmas?.join(", ");
        const subDefs = (el.article?.body?.definitions ?? []).map(renderDefinition);
        const first = subDefs[0];
        const subEntry = {
          t: lemmas ? `«${lemmas}»${first?.t ? `: ${first.t}` : ""}` : first?.t ?? "",
        };
        if (first?.e?.length) subEntry.e = first.e;
        const rest = subDefs.slice(1).filter((d) => d.t || d.e?.length || d.u?.length);
        if (rest.length) subEntry.u = rest;
        out.u.push(subEntry);
        break;
      }
      case "compound_list": {
        const intro = resolveContent(el.intro?.content, el.intro?.items);
        const words = (el.elements ?? []).map(renderItem).filter(Boolean).join(", ");
        if (intro || words) out.e.push([intro, words].filter(Boolean).join(" "));
        break;
      }
      default:
        break; // pronunciation m.m. utelates bevisst
    }
  }
  // Trim tomme felt for kompakthet
  if (out.e.length === 0) delete out.e;
  if (out.u.length === 0) delete out.u;
  return out;
}

const WORD_CLASS = {
  NOUN: "substantiv", VERB: "verb", ADJ: "adjektiv", ADV: "adverb",
  PRON: "pronomen", DET: "determinativ", ADP: "preposisjon",
  CCONJ: "konjunksjon", SCONJ: "subjunksjon", INTJ: "interjeksjon",
  EXPR: "uttrykk", PROPN: "egennavn", SYM: "symbol", ABBR: "forkorting",
  Masc: "hankjønn", Fem: "hokjønn", Neuter: "inkjekjønn/intetkjønn", "Masc/Fem": "han-/hokjønn",
};

function wordClassOf(lemmaEntries) {
  const tags = lemmaEntries?.[0]?.paradigm_info?.[0]?.tags ?? [];
  const parts = tags.map((t) => WORD_CLASS[t]).filter(Boolean);
  return parts.join(", ");
}

function inflectionsOf(lemmaEntries) {
  const seen = new Set();
  for (const le of lemmaEntries ?? []) {
    for (const p of le.paradigm_info ?? []) {
      for (const inf of p.inflection ?? []) {
        if (inf.word_form) seen.add(inf.word_form);
        if (seen.size >= MAX_FORMS_SHOWN) return [...seen];
      }
    }
  }
  return [...seen];
}

/* ---------- Hovedløp per målform ---------- */

await rm(OUT, { recursive: true, force: true });

for (const lang of LANGS) {
  const gz = join(RAW, `${lang}-article.json.gz`);
  await mkdir(RAW, { recursive: true });
  await download(`https://ord.uib.no/${lang}/fil/article.json.gz`, gz);

  console.log(`[${lang}] pakker ut og parser …`);
  const data = JSON.parse(gunzipSync(await readFile(gz)).toString("utf8"));

  const index = new Map(); // form → Set<id>
  const artShards = Array.from({ length: 256 }, () => ({}));
  let count = 0;
  let skipped = 0;

  const addForm = (form, id) => {
    const key = form.toLowerCase().trim();
    if (!key || key.length > 60) return;
    let set = index.get(key);
    if (!set) index.set(key, (set = new Set()));
    if (set.size < MAX_IDS_PER_FORM) set.add(id);
  };

  for (const [idStr, art] of Object.entries(data)) {
    const id = Number(idStr);
    const lemmaEntries = art.lemmas ?? [];
    const words = lemmaEntries.map((l) => l.lemma).filter(Boolean);
    const defs = (art.body?.definitions ?? []).map(renderDefinition)
      .filter((d) => d.t || d.e || d.u);
    if (words.length === 0 || defs.length === 0) {
      skipped++;
      continue;
    }
    const compact = { w: words, k: wordClassOf(lemmaEntries), d: defs };
    const forms = inflectionsOf(lemmaEntries);
    if (forms.length > 1) compact.b = forms;

    artShards[id % 256][id] = compact;
    for (const w of words) addForm(w, id);
    for (const f of forms) addForm(f, id);
    count++;
  }

  console.log(`[${lang}] ${count} artikler (${skipped} uten definisjon utelatt), ${index.size} oppslagsformer`);

  // Skriv artikkel-shards
  const artDir = join(OUT, lang, "art");
  await mkdir(artDir, { recursive: true });
  for (let s = 0; s < 256; s++) {
    await writeFile(join(artDir, s.toString(16).padStart(2, "0") + ".json"), JSON.stringify(artShards[s]));
  }

  // Skriv indeks-shards
  const idxShards = Array.from({ length: 256 }, () => ({}));
  for (const [form, ids] of index) {
    idxShards[parseInt(shardOf(form), 16)][form] = [...ids];
  }
  const idxDir = join(OUT, lang, "index");
  await mkdir(idxDir, { recursive: true });
  for (let s = 0; s < 256; s++) {
    await writeFile(join(idxDir, s.toString(16).padStart(2, "0") + ".json"), JSON.stringify(idxShards[s]));
  }
}

// Størrelsesrapport
const { execSync } = await import("node:child_process");
console.log("✓ ordbok-pakke bygget i", OUT);
