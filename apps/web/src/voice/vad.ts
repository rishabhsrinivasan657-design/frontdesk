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

/** The part of `@ricky0123/vad-web` we use; injectable so tests needn't load the model. */
export type SileroLoader = () => Promise<{
  MicVAD: {
    // A static method called `new`, not a constructor.
    new: (opts: {
      getStream: () => Promise<MediaStream>;
      onSpeechRealStart: () => void;
      onSpeechEnd: () => void;
      [option: string]: unknown;
    }) => Promise<MicVad>;
  };
}>;

const loadVadWeb: SileroLoader = async () => await import("@ricky0123/vad-web");

const micStream = () =>
  navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

export function createSileroVad(
  o: {
    now?: () => number;
    load?: SileroLoader;
    getUserMedia?: () => Promise<MediaStream>;
  } = {},
): Vad {
  const now = o.now ?? Date.now;
  const load = o.load ?? loadVadWeb;
  const getUserMedia = o.getUserMedia ?? micStream;
  let current: Promise<MicVad | undefined> | undefined;
  let generation = 0;
  /** The mic we opened. We close it ourselves: a failed or half-started VAD must not leave it on. */
  let stream: MediaStream | undefined;
  const closeMic = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
  };
  return {
    async start(h) {
      const mine = ++generation;
      current = (async () => {
        // Loaded on first use, so the page itself stays light.
        const { MicVAD } = await load();
        const vad = await MicVAD.new({
          model: "v5",
          baseAssetPath: ASSETS,
          onnxWASMBasePath: ASSETS,
          redemptionMs: REDEMPTION_MS,
          minSpeechMs: MIN_SPEECH_MS,
          startOnLoad: false,
          getStream: async () => {
            const opened = await getUserMedia();
            if (mine === generation) stream = opened;
            else opened.getTracks().forEach((t) => t.stop());
            return opened;
          },
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
        try {
          await vad.start();
        } catch (error) {
          if (mine === generation) closeMic();
          throw error;
        }
        return vad;
      })();
      await current;
    },
    stop() {
      generation += 1;
      closeMic();
      const was = current;
      current = undefined;
      void was?.then((vad) => vad?.destroy()).catch(() => undefined);
    },
  };
}
