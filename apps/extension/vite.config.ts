import { defineConfig } from "vite";

// Bygger service worker + offscreen-dokument (ES-moduler).
// Content scriptet bygges separat som IIFE i vite.content.config.ts,
// siden MV3 ikke støtter ES-moduler i content scripts.
export default defineConfig({
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
