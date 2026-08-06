import { defineConfig } from "vite";

// Bygger service worker + offscreen-dokument (ES-moduler).
// Content scriptet bygges separat som IIFE i vite.content.config.ts,
// siden MV3 ikke støtter ES-moduler i content scripts.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome110",
    rollupOptions: {
      input: {
        background: "src/background.ts",
        offscreen: "offscreen.html",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
