/**
 * Voice activity detection: is someone speaking right now? Silero VAD (a small neural model,
 * ~2 MB) runs in the browser on the microphone, which is far more reliable than guessing from
 * when Web Speech's words change.
 */
export interface VadHandlers {
  /** Real speech started (not a click or cough shorter than the minimum). */
  onSpeechStart(): void;
  /** Speech stopped; `at` is when the silence began (epoch ms). */
  onSpeechEnd(at: number): void;
}

export interface Vad {
  /** Opens the mic and starts listening; rejects if the model or mic can't start. */
  start(h: VadHandlers): Promise<void>;
  stop(): void;
}

/** Silence the VAD needs before it says speech ended; the endpointer decides the rest. */
const REDEMPTION_MS = 200;
/** Shorter blips are ignored. */
const MIN_SPEECH_MS = 150;
/** Where `scripts/copy-vad-assets.mjs` puts the model, worklet and onnxruntime files. */
const ASSETS = "/vad/";

type MicVad = { start(): Promise<void>; destroy(): Promise<void> | void };

export function createSileroVad(now: () => number = Date.now): Vad {
  let current: Promise<MicVad | undefined> | undefined;
  let generation = 0;
  return {
    async start(h) {
      const mine = ++generation;
      current = (async () => {
        // Loaded on first use, so the page itself stays light.
        const { MicVAD } = await import("@ricky0123/vad-web");
        const vad = await MicVAD.new({
          model: "v5",
          baseAssetPath: ASSETS,
          onnxWASMBasePath: ASSETS,
          redemptionMs: REDEMPTION_MS,
          minSpeechMs: MIN_SPEECH_MS,
          startOnLoad: false,
          getStream: () =>
            navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            }),
          onSpeechRealStart: () => {
            if (mine === generation) h.onSpeechStart();
          },
          onSpeechEnd: () => {
            if (mine === generation) h.onSpeechEnd(now() - REDEMPTION_MS);
          },
        });
        if (mine !== generation) {
          await vad.destroy();
          return undefined;
        }
        await vad.start();
        return vad;
      })();
      await current;
    },
    stop() {
      generation += 1;
      const was = current;
      current = undefined;
      void was?.then((vad) => vad?.destroy()).catch(() => undefined);
    },
  };
}
