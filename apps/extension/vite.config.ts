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


// Bygger service worker + offscreen-dokument (ES-moduler).
// Content scriptet bygges separat som IIFE i vite.content.config.ts,
// siden MV3 ikke støtter ES-moduler i content scripts.
export default defineConfig({
  define: { __BUTIKK__: JSON.stringify(BUTIKK) },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome110",
    // Ingen modulepreload-polyfill: unødvendig i moderne Chromium, og gir
    // «cross-world resource mismatch»-støy i utvidelseskontekster
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        background: "src/background.ts",
        offscreen: "offscreen.html",
        popup: "popup.html",
        om: "om.html",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
