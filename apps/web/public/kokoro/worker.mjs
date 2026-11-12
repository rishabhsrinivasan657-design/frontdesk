// Runs Kokoro (an open 82M-parameter neural TTS model) off the main thread, so generating audio
// never freezes the page (src/voice/kokoro-tts.ts). Plain JS served as-is, because Kokoro's
// self-contained browser bundle loads its runtime with dynamic imports that webpack would break.
// The bundle comes from a CDN at a pinned version, like the model weights (Hugging Face). Messages: {type:"load"} → {type:"ready", device} or
// {type:"error"}; {type:"say", id, text} → {type:"audio", id, audio, rate}.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
/** A warm, natural American voice; `?voice=<id>` on /talk picks another (`tts.list_voices()`). */
const VOICE = "af_heart";

let tts;
let device;

async function load() {
  if (!tts) {
    // WebGPU is much faster where it exists; WASM works everywhere else.
    const gpu = "gpu" in navigator && (await navigator.gpu.requestAdapter().catch(() => null));
    device = gpu ? "webgpu" : "wasm";
    tts = KokoroTTS.from_pretrained(MODEL, { dtype: gpu ? "fp32" : "q8", device });
  }
  return await tts;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      const model = await load();
      // The first generation compiles GPU shaders (~2 s); pay that now, not on the first reply.
      const t0 = performance.now();
      await model.generate("Hello.", { voice: m.voice ?? VOICE });
      console.info(`kokoro warm-up: ${Math.round(performance.now() - t0)} ms`);
      self.postMessage({ type: "ready", device });
      return;
    }
    const model = await load();
    const t0 = performance.now();
    const out = await model.generate(m.text, { voice: m.voice ?? VOICE });
    console.info(`kokoro: ${Math.round(performance.now() - t0)} ms for ${m.text.length} chars`);
    const audio = out.audio;
    self.postMessage({ type: "audio", id: m.id, audio, rate: out.sampling_rate }, [audio.buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      id: m.type === "say" ? m.id : undefined,
      message: String(error),
    });
  }
};
