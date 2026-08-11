import { defineConfig } from "vite";

// COOP/COEP gir crossOriginIsolated → ORT kan bruke tråder (opptil 4).
// Mulig fordi alle ressurser (stemme, WASM, ordbank) serveres lokalt.
// Utvidelsen får det samme via manifest-nøklene cross_origin_*_policy.
export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
