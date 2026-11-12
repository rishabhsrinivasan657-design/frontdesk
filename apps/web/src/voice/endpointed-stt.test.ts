import { describe, expect, it } from "vitest";
import { COMPLETE_MS, HARD_CAP_MS } from "./endpointer";
import { createEndpointedStt } from "./endpointed-stt";
import { FakeRecognition, FakeVad, fakeClock, recordingHandlers, withRecognition } from "./fakes";
import { SILENCE_MS, createWebSpeechStt } from "./web-speech";

const finals = (calls: string[]) => calls.filter((c) => c.startsWith("final:"));

async function setup(o: { failVad?: boolean; vad?: FakeVad } = {}) {
  const c = fakeClock();
  const recognizer = createWebSpeechStt(withRecognition(), c.now, c.timers, { silenceMs: null });
  const vad = o.vad ?? new FakeVad(o.failVad);
  const stt = createEndpointedStt({ recognizer, vad, now: c.now, timers: c.timers });
  const h = recordingHandlers();
  stt.start(h);
  await Promise.resolve();
  await Promise.resolve();
  const r = FakeRecognition.last!;
  // Chrome fires `end` after stop(); the fake leaves that to the test.
  const end = () => r.onend?.();
  return { c, vad, stt, h, r, end };
}

describe("createEndpointedStt", () => {
  it("is supported exactly when the recogniser is", () => {
    const c = fakeClock();
    const off = createWebSpeechStt({}, c.now, c.timers, { silenceMs: null });
    expect(createEndpointedStt({ recognizer: off, vad: new FakeVad() }).supported).toBe(false);
  });

  it("sends once when the VAD says silence and the words sound finished", async () => {
    const { c, vad, h, r, end } = await setup();
    vad.speechStart();
    r.result([{ text: "yes", final: false }]);
    vad.speechEnd(c.now());
    c.advance(COMPLETE_MS - 1);
    expect(finals(h.calls)).toEqual([]);
    c.advance(1);
    expect(finals(h.calls)).toEqual([
      `final:yes:${JSON.stringify({ speechEnd: 0, sttFinal: 300 })}`,
    ]);
    expect(r.stopped).toBe(1);
    expect(vad.stops).toBe(1);
    end();
    expect(finals(h.calls)).toHaveLength(1);
    expect(h.calls.at(-1)).toBe("end");
  });

  it("forwards the VAD's speech start as the barge-in signal", async () => {
    const { vad, h } = await setup();
    vad.speechStart();
    expect(h.calls).toContain("start");
  });

  it("includes a word that arrives after the VAD's silence", async () => {
    const { c, vad, h, r } = await setup();
    vad.speechStart();
    r.result([{ text: "a table for", final: false }]);
    vad.speechEnd(c.now());
    c.advance(150);
    r.result([{ text: "a table for four on friday at 7", final: false }]);
    c.advance(1000);
    expect(finals(h.calls)).toHaveLength(1);
    expect(finals(h.calls)[0]).toContain("final:a table for four on friday at 7:");
  });

  it("the recogniser's late final after we finished doesn't send twice", async () => {
    const { c, vad, h, r, end } = await setup();
    r.result([{ text: "yes", final: false }]);
    vad.speechEnd(c.now());
    c.advance(COMPLETE_MS);
    r.result([{ text: "yes", final: true }]);
    end();
    expect(finals(h.calls)).toHaveLength(1);
  });

  it("tap (stop) sends what was heard now", async () => {
    const { stt, vad, h, r, end } = await setup();
    vad.speechStart();
    r.result([{ text: "a table for", final: false }]);
    stt.stop();
    end();
    expect(finals(h.calls)).toHaveLength(1);
    expect(finals(h.calls)[0]).toContain("final:a table for:");
    expect(vad.stops).toBeGreaterThan(0);
  });

  it("no words, only noise: no final, and onEnd still fires", async () => {
    const { c, vad, h, end } = await setup();
    vad.speechStart();
    vad.speechEnd(c.now());
    c.advance(10_000);
    end();
    expect(finals(h.calls)).toEqual([]);
    expect(h.calls.at(-1)).toBe("end");
  });

  it("falls back to word timing, never quicker than the old 1.5 s timer, when the VAD can't start", async () => {
    const { c, h, r } = await setup({ failVad: true });
    r.onspeechstart?.();
    r.result([{ text: "yes", final: false }]);
    c.advance(SILENCE_MS - 1);
    expect(finals(h.calls)).toEqual([]);
    c.advance(1);
    expect(finals(h.calls)).toHaveLength(1);
    expect(h.calls).toContain("start");
  });

  it("a caller who finishes before the VAD is ready is still answered", async () => {
    const vad = new FakeVad(false, true);
    const { c, h, r } = await setup({ vad });
    r.result([{ text: "yes", final: false }]);
    c.advance(200);
    await vad.ready();
    c.advance(COMPLETE_MS);
    expect(finals(h.calls)).toHaveLength(1);
  });

  it("noise but no words: stops listening after the hard cap", async () => {
    const { c, vad, h, r, end } = await setup();
    vad.speechStart();
    vad.speechEnd(c.now());
    c.advance(HARD_CAP_MS);
    expect(r.stopped).toBe(1);
    end();
    expect(finals(h.calls)).toEqual([]);
    expect(h.calls.at(-1)).toBe("end");
  });

  it("words that arrive after the turn was sent are not shown as pending", async () => {
    const { c, vad, h, r } = await setup();
    r.result([{ text: "yes", final: false }]);
    vad.speechEnd(c.now());
    c.advance(COMPLETE_MS);
    const before = h.calls.length;
    r.result([{ text: "yes please", final: true }]);
    expect(h.calls.slice(before).filter((x) => x.startsWith("interim:"))).toEqual([]);
  });
});
