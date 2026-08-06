/**
 * Laster ned Piper-stemmen(e) til assets/voices/ (én gang, ~63 MB per stemme).
 * Filene pakkes deretter inn i utvidelsen og demoen av copy-assets.mjs,
 * slik at sluttbrukeren aldri trenger internett.
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HF_BASE = "https://huggingface.co/diffusionstudio/piper-voices/resolve/main";

const VOICES = [
  "no/no_NO/talesyntese/medium/no_NO-talesyntese-medium.onnx",
  "no/no_NO/talesyntese/medium/no_NO-talesyntese-medium.onnx.json",
];

for (const rel of VOICES) {
  const dest = join(ROOT, "assets", "voices", ...rel.split("/"));
  const exists = await stat(dest).then((s) => s.size > 0).catch(() => false);
  if (exists) {
    console.log(`✓ finnes allerede: ${rel}`);
    continue;
  }
  console.log(`⬇ laster ned ${rel} …`);
  const res = await fetch(`${HF_BASE}/${rel}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${rel}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`✓ lagret ${dest} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
console.log("Ferdig.");
