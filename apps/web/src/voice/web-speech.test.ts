import { describe, expect, it, vi } from "vitest";
import type { SttHandlers } from "./types";
import { type WebSpeechGlobals, createWebSpeechStt, createWebSpeechTts } from "./web-speech";

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

describe("createWebSpeechStt", () => {
  it("is unsupported without SpeechRecognition, and reports an error instead of throwing", () => {
    const stt = createWebSpeechStt({});
    expect(stt.supported).toBe(false);
    const h = handlers();
    stt.start(h);
    expect(h.calls).toEqual(["error:other"]);
  });

  it("uses webkitSpeechRecognition with interim results, en-US, one utterance", () => {
    const stt = createWebSpeechStt(withRecognition());
    expect(stt.supported).toBe(true);
    stt.start(handlers());
    const r = FakeRecognition.last!;
    expect([r.lang, r.interimResults, r.continuous, r.started]).toEqual(["en-US", true, false, 1]);
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
