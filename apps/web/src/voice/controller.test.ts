import { describe, expect, it, vi } from "vitest";
import { type VoiceStatus, VoiceController } from "./controller";
import { FakeStt, FakeTts } from "./fakes";
import { Speaker } from "./speaker";

function setup(opts: { supported?: boolean; accept?: boolean } = {}) {
  const stt = new FakeStt(opts.supported ?? true);
  const tts = new FakeTts();
  const speaker = new Speaker(tts, { onTtsStarted: () => {}, onChange: () => {} });
  let accept = opts.accept ?? true;
  const sent: [string, unknown][] = [];
  const statuses: VoiceStatus[] = [];
  const deps = {
    stt,
    speaker,
    sendText: vi.fn((text: string, timings: unknown) => {
      if (!accept) return false;
      sent.push([text, timings]);
      return true;
    }),
    sendInterrupt: vi.fn(),
    onStatus: (s: VoiceStatus) => statuses.push(s),
    onInterim: vi.fn(),
    onSttMs: vi.fn(),
  };
  const controller = new VoiceController(deps);
  return {
    stt,
    tts,
    speaker,
    deps,
    controller,
    sent,
    statuses,
    accept: (a: boolean) => (accept = a),
  };
}

describe("VoiceController", () => {
  it("press while speaking stops speech and sends interrupt", () => {
    const s = setup();
    s.speaker.enqueue("turn_1", "Hello.");
    s.controller.press(false);
    expect(s.tts.cancels).toBe(1);
    expect(s.deps.sendInterrupt).toHaveBeenCalledOnce();
    expect(s.stt.starts).toBe(1);
    expect(s.statuses.at(-1)).toBe("listening");
  });

  it("press while the chat is busy sends interrupt", () => {
    const s = setup();
    s.controller.press(true);
    expect(s.deps.sendInterrupt).toHaveBeenCalledOnce();
  });

  it("press while idle sends no interrupt", () => {
    const s = setup();
    s.controller.press(false);
    expect(s.deps.sendInterrupt).not.toHaveBeenCalled();
    expect(s.controller.used).toBe(true);
  });

  it("press while listening stops listening", () => {
    const s = setup();
    s.controller.press(false);
    s.controller.press(false);
    expect(s.stt.stops).toBe(1);
    expect(s.statuses.at(-1)).toBe("idle");
  });

  it("speech starting while we speak barges in", () => {
    const s = setup();
    s.controller.press(false);
    s.speaker.unmute();
    s.speaker.enqueue("turn_1", "Hello.");
    s.stt.handlers!.onSpeechStart();
    expect(s.tts.cancels).toBe(1);
    expect(s.deps.sendInterrupt).toHaveBeenCalledOnce();
  });

  it("sends the final transcript as caller text with its timings, and shows interim text", () => {
    const s = setup();
    s.controller.press(false);
    s.stt.handlers!.onInterim("a table");
    s.stt.handlers!.onFinal("a table for 4", { speechEnd: 1000, sttFinal: 1300 });
    expect(s.deps.onInterim).toHaveBeenCalledWith("a table");
    expect(s.sent).toEqual([["a table for 4", { speechEnd: 1000, sttFinal: 1300 }]]);
    expect(s.deps.onSttMs).toHaveBeenCalledWith(300);
  });

  it("unmutes the speaker once the transcript is sent", () => {
    const s = setup();
    s.speaker.enqueue("turn_1", "Hello.");
    s.controller.press(false);
    s.stt.handlers!.onFinal("hi", { sttFinal: 1 });
    s.speaker.enqueue("turn_2", "Hi again.");
    expect(s.tts.spoken).toEqual(["Hello.", "Hi again."]);
  });

  it("holds a final transcript until the chat is idle, then sends it once", () => {
    const s = setup({ accept: false });
    s.controller.press(true);
    s.stt.handlers!.onFinal("actually, 8pm", { sttFinal: 1 });
    expect(s.sent).toEqual([]);
    s.accept(true);
    s.controller.chatIdle();
    s.controller.chatIdle();
    expect(s.sent.map(([t]) => t)).toEqual(["actually, 8pm"]);
  });

  it("a spoken yes is only ever caller text", () => {
    const s = setup();
    s.controller.press(false);
    s.stt.handlers!.onFinal("yes", { sttFinal: 1 });
    expect(s.deps.sendText).toHaveBeenCalledExactlyOnceWith("yes", { sttFinal: 1 });
    expect(s.deps.sendInterrupt).not.toHaveBeenCalled();
  });

  it("unsupported recognition reports unsupported and never starts", () => {
    const s = setup({ supported: false });
    expect(s.controller.status).toBe("unsupported");
    s.controller.press(false);
    expect(s.stt.starts).toBe(0);
  });

  it("a blocked microphone reports denied; no speech goes back to idle", () => {
    const s = setup();
    s.controller.press(false);
    s.stt.handlers!.onError("not-allowed");
    expect(s.controller.status).toBe("denied");
    s.controller.press(false);
    s.stt.handlers!.onError("no-speech");
    s.stt.handlers!.onEnd();
    expect(s.controller.status).toBe("idle");
  });
});
