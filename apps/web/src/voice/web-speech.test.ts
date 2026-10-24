import { describe, expect, it, vi } from "vitest";
import type { SttHandlers } from "./types";
import {
  SILENCE_MS,
  type Timers,
  type WebSpeechGlobals,
  createWebSpeechStt,
  createWebSpeechTts,
} from "./web-speech";

type Listener = (event?: unknown) => void;

/** Stands in for the browser's SpeechRecognition: the test fires its events. */
class FakeRecognition {
  static last: FakeRecognition | undefined;
  lang = "";
  interimResults = false;
  continuous = true;
  started = 0;
  stopped = 0;
  onspeechstart: Listener | null = null;
  onspeechend: Listener | null = null;
  onresult: Listener | null = null;
  onerror: Listener | null = null;
  onend: Listener | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  abort() {
    this.stopped += 1;
  }
  /** One result list, as the browser sends it: earlier results stay, the last may be interim. */
  result(parts: { text: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.final }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

function handlers(): SttHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onSpeechStart: () => calls.push("start"),
    onInterim: (t) => calls.push(`interim:${t}`),
    onFinal: (t, timings) => calls.push(`final:${t}:${JSON.stringify(timings)}`),
    onError: (e) => calls.push(`error:${e}`),
    onEnd: () => calls.push("end"),
  };
}

const withRecognition = (): WebSpeechGlobals => ({
  webkitSpeechRecognition: FakeRecognition,
});

/** A clock and timers the test moves by hand: `advance` fires timers that come due, in order. */
function fakeClock() {
  let t = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: t + ms, fn });
      return id;
    },
    clear: (id) => pending.delete(id as number),
  };
  return {
    now: () => t,
    timers,
    pending: () => pending.size,
    set: (ms: number) => (t = ms),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...pending].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at);
        const first = due[0];
        if (!first) break;
        pending.delete(first[0]);
        t = first[1].at;
        first[1].fn();
      }
      t = end;
    },
  };
}

describe("createWebSpeechStt", () => {
  it("is unsupported without SpeechRecognition, and reports an error instead of throwing", () => {
    const stt = createWebSpeechStt({});
    expect(stt.supported).toBe(false);
    const h = handlers();
    stt.start(h);
    expect(h.calls).toEqual(["error:other"]);
  });

  it("uses webkitSpeechRecognition with interim results, en-US, continuous (we endpoint)", () => {
    const stt = createWebSpeechStt(withRecognition());
    expect(stt.supported).toBe(true);
    stt.start(handlers());
    const r = FakeRecognition.last!;
    expect([r.lang, r.interimResults, r.continuous, r.started]).toEqual(["en-US", true, true, 1]);
  });

  it("reports speech start, interim text, then the final text with its timings", () => {
    let t = 0;
    const stt = createWebSpeechStt(withRecognition(), () => t);
    const h = handlers();
    stt.start(h);
    const r = FakeRecognition.last!;
    r.onspeechstart?.();
    r.result([{ text: "a table", final: false }]);
    t = 1000;
    r.onspeechend?.();
    t = 1300;
    r.result([{ text: " a table for 4 ", final: true }]);
    r.onend?.();
    expect(h.calls).toEqual([
      "start",
      "interim:a table",
      'final:a table for 4:{"speechEnd":1000,"sttFinal":1300}',
      "end",
    ]);
  });

  it("uses the last interim result as end of speech when Chrome finalizes before speechend", () => {
    let t = 0;
    const stt = createWebSpeechStt(withRecognition(), () => t);
    const h = handlers();
    stt.start(h);
    const r = FakeRecognition.last!;
    r.onspeechstart?.();
    t = 400;
    r.result([{ text: "a table", final: false }]);
    t = 900;
    r.result([{ text: "a table for four", final: false }]);
    t = 1500;
    r.result([{ text: "a table for four", final: true }]);
    t = 1600;
    r.onspeechend?.();
    expect(h.calls).toContain('final:a table for four:{"speechEnd":900,"sttFinal":1500}');
  });

  it("drops an empty final transcript", () => {
    const stt = createWebSpeechStt(withRecognition());
    const h = handlers();
    stt.start(h);
    FakeRecognition.last!.result([{ text: "  ", final: true }]);
    FakeRecognition.last!.onend?.();
    expect(h.calls).toEqual(["end"]);
  });

  it("maps not-allowed and service-not-allowed to not-allowed", () => {
    const stt = createWebSpeechStt(withRecognition());
    for (const error of ["not-allowed", "service-not-allowed", "no-speech", "weird"]) {
      const h = handlers();
      stt.start(h);
      FakeRecognition.last!.onerror?.({ error });
      expect(h.calls).toEqual([
        `error:${error === "service-not-allowed" ? "not-allowed" : error === "weird" ? "other" : error}`,
      ]);
    }
  });

  describe("endpointing (our own silence timer)", () => {
    const finals = (calls: string[]) => calls.filter((c) => c.startsWith("final:"));

    it("finalizes after SILENCE_MS with no new words, then stops the recognizer", () => {
      const c = fakeClock();
      const stt = createWebSpeechStt(withRecognition(), c.now, c.timers);
      const h = handlers();
      stt.start(h);
      const r = FakeRecognition.last!;
      c.set(400);
      r.result([{ text: "a table", final: false }]);
      c.set(900);
      r.result([{ text: "a table for four", final: false }]);
      c.advance(SILENCE_MS - 1);
      expect(finals(h.calls)).toEqual([]);
      c.advance(1);
      expect(finals(h.calls)).toEqual([
        `final:a table for four:{"speechEnd":900,"sttFinal":${900 + SILENCE_MS}}`,
      ]);
      expect(r.stopped).toBe(1);
    });

    it("restarts the silence window whenever the words change", () => {
      const c = fakeClock();
      const stt = createWebSpeechStt(withRecognition(), c.now, c.timers);
      const h = handlers();
      stt.start(h);
      const r = FakeRecognition.last!;
      r.result([{ text: "a table", final: false }]);
      c.advance(SILENCE_MS - 100);
      r.result([{ text: "a table for", final: false }]);
      c.advance(SILENCE_MS - 100);
      expect(finals(h.calls)).toEqual([]);
      c.advance(100);
      expect(finals(h.calls)).toHaveLength(1);
    });

    it("uses Chrome's own final if it comes first, and cancels the timer", () => {
      const c = fakeClock();
      const stt = createWebSpeechStt(withRecognition(), c.now, c.timers);
      const h = handlers();
      stt.start(h);
      const r = FakeRecognition.last!;
      c.set(400);
      r.result([{ text: "a table for four", final: false }]);
      c.set(700);
      r.result([{ text: "a table for four", final: true }]);
      expect(c.pending()).toBe(0);
      c.advance(SILENCE_MS * 2);
      expect(finals(h.calls)).toEqual(['final:a table for four:{"speechEnd":400,"sttFinal":700}']);
    });

    it("ignores Chrome's late final after we already finalized: onFinal fires once", () => {
      const c = fakeClock();
      const stt = createWebSpeechStt(withRecognition(), c.now, c.timers);
      const h = handlers();
      stt.start(h);
      const r = FakeRecognition.last!;
      r.result([{ text: "a table for four", final: false }]);
      c.advance(SILENCE_MS);
      r.result([{ text: "a table for four", final: true }]);
      r.result([{ text: "a table for four please", final: false }]);
      c.advance(SILENCE_MS * 2);
      r.onend?.();
      expect(finals(h.calls)).toHaveLength(1);
      expect(h.calls.filter((call) => call.startsWith("interim:"))).toHaveLength(1);
      expect(h.calls.at(-1)).toBe("end");
    });

    it("stop() cancels the timer; the final Chrome sends on stop still comes through once", () => {
      const c = fakeClock();
      const stt = createWebSpeechStt(withRecognition(), c.now, c.timers);
      const h = handlers();
      stt.start(h);
      const r = FakeRecognition.last!;
      c.set(400);
      r.result([{ text: "a table", final: false }]);
      stt.stop();
      expect(c.pending()).toBe(0);
      c.advance(SILENCE_MS * 2);
      expect(finals(h.calls)).toEqual([]);
      r.result([{ text: "a table", final: true }]);
      expect(finals(h.calls)).toHaveLength(1);
    });

    it("an error cancels the timer", () => {
      const c = fakeClock();
      const stt = createWebSpeechStt(withRecognition(), c.now, c.timers);
      const h = handlers();
      stt.start(h);
      const r = FakeRecognition.last!;
      r.result([{ text: "a table", final: false }]);
      r.onerror?.({ error: "network" });
      c.advance(SILENCE_MS * 2);
      expect(finals(h.calls)).toEqual([]);
    });
  });

  it("stop stops the recognizer", () => {
    const stt = createWebSpeechStt(withRecognition());
    stt.start(handlers());
    stt.stop();
    expect(FakeRecognition.last!.stopped).toBe(1);
  });
});

describe("createWebSpeechTts", () => {
  class FakeUtterance {
    lang = "";
    onstart: Listener | null = null;
    onend: Listener | null = null;
    onerror: Listener | null = null;
    constructor(readonly text: string) {}
  }

  it("speaks an en-US utterance and forwards start and end", () => {
    const spoken: FakeUtterance[] = [];
    const synth = { speak: (u: FakeUtterance) => spoken.push(u), cancel: vi.fn() };
    const tts = createWebSpeechTts({
      speechSynthesis: synth as unknown as WebSpeechGlobals["speechSynthesis"],
      SpeechSynthesisUtterance:
        FakeUtterance as unknown as WebSpeechGlobals["SpeechSynthesisUtterance"],
    });
    expect(tts.supported).toBe(true);
    const calls: string[] = [];
    tts.speak("Hello there.", {
      onStart: () => calls.push("start"),
      onEnd: () => calls.push("end"),
    });
    expect(spoken.map((u) => [u.text, u.lang])).toEqual([["Hello there.", "en-US"]]);
    spoken[0]!.onstart?.();
    spoken[0]!.onend?.();
    expect(calls).toEqual(["start", "end"]);
    tts.cancel();
    expect(synth.cancel).toHaveBeenCalled();
  });

  it("an utterance error ends it, so the queue moves on", () => {
    const spoken: FakeUtterance[] = [];
    const tts = createWebSpeechTts({
      speechSynthesis: {
        speak: (u: FakeUtterance) => spoken.push(u),
        cancel: () => {},
      } as unknown as WebSpeechGlobals["speechSynthesis"],
      SpeechSynthesisUtterance:
        FakeUtterance as unknown as WebSpeechGlobals["SpeechSynthesisUtterance"],
    });
    const onEnd = vi.fn();
    tts.speak("Hi.", { onStart: () => {}, onEnd });
    spoken[0]!.onerror?.();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("is unsupported without speechSynthesis", () => {
    expect(createWebSpeechTts({}).supported).toBe(false);
  });
});
