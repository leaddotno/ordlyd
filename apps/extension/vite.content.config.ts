import { defineConfig } from "vite";
/*
 * Butikken velges ved bygging og bakes inn. Se src/butikk.ts for hvorfor
 * det ikke er en kjøretidssjekk: Chrome-pakken skal ikke inneholde ordet
 * «edge», og da kan begge variantene ikke ligge i samme bundle.
 *
 * Standard er "edge", slik at et bygg uten miljøvariabel gir det samme
 * som før dette ble innført.
 */
const BUTIKK = process.env.ORDLYD_BUTIKK === "chrome" ? "chrome" : "edge";


// Content script som selvstendig IIFE-bundle (MV3-krav).
export default defineConfig({
  publicDir: false, // manifest.json kopieres av hovedbygget
  define: { __BUTIKK__: JSON.stringify(BUTIKK) },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome110",
    lib: {
      entry: "src/content.ts",
      name: "ssContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
