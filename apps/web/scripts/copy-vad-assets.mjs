// Copies the Silero VAD model, its audio worklet and the onnxruntime-web WASM files into
// public/vad/, so the browser loads them from our own site (src/voice/vad.ts). Runs before
// `dev` and `build`; public/vad/ is generated, so it's gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vadDir = dirname(require.resolve("@ricky0123/vad-web"));
const ortDir = dirname(createRequire(join(vadDir, "index.js")).resolve("onnxruntime-web/wasm"));
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vad");

const files = [
  [vadDir, "silero_vad_v5.onnx"],
  [vadDir, "vad.worklet.bundle.min.js"],
  [ortDir, "ort-wasm-simd-threaded.mjs"],
  [ortDir, "ort-wasm-simd-threaded.wasm"],
];
mkdirSync(out, { recursive: true });
for (const [dir, name] of files) copyFileSync(join(dir, name), join(out, name));
console.log(`copied ${files.length} VAD assets to public/vad/`);
