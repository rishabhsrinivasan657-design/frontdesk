import { describe, expect, it } from "vitest";
import { BARGE_IN, type SileroLoader, createSileroVad } from "./vad";

/** A MediaStream stand-in that records whether its tracks were stopped. */
function fakeStream() {
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

/** A vad-web stand-in: `start()` opens the stream, then fails if asked to (a 404 worklet). */
function loader(o: { failAfterStream?: boolean }): SileroLoader {
  return () =>
    Promise.resolve({
      MicVAD: {
        new: (opts: { getStream: () => Promise<MediaStream> }) =>
          Promise.resolve({
            start: async () => {
              await opts.getStream();
              if (o.failAfterStream) throw new Error("addModule failed");
            },
            destroy: () => {},
          }),
      },
    });
}

const handlers = { onSpeechStart: () => {}, onSpeechEnd: () => {} };

describe("createSileroVad", () => {
  it("closes the mic if starting fails after the stream opened", async () => {
    const { stream, track } = fakeStream();
    const vad = createSileroVad({
      load: loader({ failAfterStream: true }),
      getUserMedia: () => Promise.resolve(stream),
    });
    await expect(vad.start(handlers)).rejects.toThrow("addModule failed");
    expect(track.stopped).toBe(true);
  });

  it("stop() closes the mic", async () => {
    const { stream, track } = fakeStream();
    const vad = createSileroVad({ load: loader({}), getUserMedia: () => Promise.resolve(stream) });
    await vad.start(handlers);
    expect(track.stopped).toBe(false);
    vad.stop();
    expect(track.stopped).toBe(true);
  });
});

describe("VAD sensitivity", () => {
  it("ignores background noise: much stricter than the library's defaults (0.3, 400 ms)", async () => {
    const seen: Record<string, unknown>[] = [];
    const load: SileroLoader = () =>
      Promise.resolve({
        MicVAD: {
          new: (opts) => {
            seen.push(opts);
            return Promise.resolve({ start: () => Promise.resolve(), destroy: () => {} });
          },
        },
      });
    const { stream } = fakeStream();
    await createSileroVad({ load, getUserMedia: () => Promise.resolve(stream) }).start(handlers);
    await createSileroVad({ load, getUserMedia: () => Promise.resolve(stream), ...BARGE_IN }).start(
      handlers,
    );
    expect(seen[0]).toMatchObject({
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.45,
      minSpeechMs: 250,
    });
    expect(seen[1]).toMatchObject({
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.65,
      minSpeechMs: 300,
    });
  });
});
