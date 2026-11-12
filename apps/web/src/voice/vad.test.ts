import { describe, expect, it } from "vitest";
import { type SileroLoader, createSileroVad } from "./vad";

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
