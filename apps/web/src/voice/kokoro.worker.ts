/// <reference lib="webworker" />
/**
 * Runs Kokoro (an open 82M-parameter neural TTS model) off the main thread, so generating audio
 * never freezes the page. Messages: `{type:"load"}` → `{type:"ready", device}` or
 * `{type:"error"}`; `{type:"say", id, text}` → `{type:"audio", id, audio, rate}`.
 */
import { KokoroTTS } from "kokoro-js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
/** A warm, natural American voice; `tts.list_voices()` has the rest. */
const VOICE = "af_heart";

let tts: Promise<KokoroTTS> | undefined;

async function load(): Promise<{ tts: KokoroTTS; device: string }> {
  // WebGPU is much faster where it exists; WASM works everywhere else.
  const gpu =
    "gpu" in navigator &&
    (await (navigator as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter());
  const device = gpu ? "webgpu" : "wasm";
  tts ??= KokoroTTS.from_pretrained(MODEL, { dtype: gpu ? "fp32" : "q8", device });
  return { tts: await tts, device };
}

self.onmessage = async (
  e: MessageEvent<{ type: "load" } | { type: "say"; id: number; text: string }>,
) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      const { device } = await load();
      self.postMessage({ type: "ready", device });
      return;
    }
    const { tts: model } = await load();
    const out = await model.generate(m.text, { voice: VOICE });
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
