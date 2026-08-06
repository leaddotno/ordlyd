import { defineConfig } from "vite";

// Content script som selvstendig IIFE-bundle (MV3-krav).
export default defineConfig({
  publicDir: false, // manifest.json kopieres av hovedbygget
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
