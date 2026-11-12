// Copies the Silero VAD model, its audio worklet and the onnxruntime-web WASM files into
// public/vad/ (and Kokoro's browser bundle into public/kokoro/), so the browser loads them from our own site (src/voice/vad.ts). Runs before
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

// Kokoro's self-contained browser bundle, next to public/kokoro/worker.mjs (src/voice/kokoro-tts.ts).
const kokoroDir = join(dirname(require.resolve("kokoro-js")), "..", "dist");
copyFileSync(join(kokoroDir, "kokoro.web.js"), join(out, "..", "kokoro", "kokoro.web.js"));
console.log("copied kokoro.web.js to public/kokoro/");
