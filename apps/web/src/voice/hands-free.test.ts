import { describe, expect, it, vi } from "vitest";
import { VoiceController } from "./controller";
import { FakeStt, FakeTts, FakeVad, fakeClock } from "./fakes";
import { COMMIT_MS, HandsFree, IDLE_MS } from "./hands-free";
import { Speaker } from "./speaker";

function setup() {
  const clock = fakeClock();
  const stt = new FakeStt();
  const tts = new FakeTts();
  const vad = new FakeVad();
  let busy = false;
  const speaker = new Speaker(tts, { onTtsStarted: () => {}, onChange: () => hf.update() });
  const sendInterrupt = vi.fn();
  const controller = new VoiceController({
    stt,
    speaker,
    sendText: () => {
      hf.heard();
      return true;
    },
    sendInterrupt,
    onStatus: () => hf.update(),
    onInterim: () => {},
    onSttMs: () => {},
    onDropped: () => {},
  });
  const hf: HandsFree = new HandsFree({
    controller,
    speaker,
    vad,
    isChatBusy: () => busy,
    timers: clock.timers,
    now: clock.now,
  });
  const say = (text: string) => {
    stt.handlers!.onFinal(text, { sttFinal: clock.now() });
    stt.handlers!.onEnd();
  };
  const flush = () => Promise.resolve().then(() => Promise.resolve());
  return {
    clock,
    stt,
    tts,
    vad,
    speaker,
    controller,
    hf,
    say,
    flush,
    sendInterrupt,
    busy: (b: boolean) => {
      busy = b;
      hf.update();
    },
  };
}

describe("HandsFree", () => {
  it("listens again once the reply has been spoken", () => {
    const s = setup();
    s.hf.start();
    expect(s.stt.starts).toBe(1);
    s.say("a table for four");
    expect(s.stt.starts).toBe(1); // waits for the reply, even before the chat shows busy
    s.speaker.enqueue("t1", "Sure.");
    s.hf.turnDone();
    expect(s.stt.starts).toBe(1);
    s.tts.end();
    expect(s.stt.starts).toBe(2);
    expect(s.controller.status).toBe("listening");
  });

  it("talking over the reply ducks it, then barges in if the caller keeps going", async () => {
    const s = setup();
    s.hf.start();
    s.say("hello");
    s.speaker.enqueue("t1", "Hi! How can I help with a reservation today?");
    await s.flush();
    s.vad.speechStart();
    expect(s.tts.volume).toBeLessThan(1);
    expect(s.sendInterrupt).not.toHaveBeenCalled();
    s.clock.advance(COMMIT_MS);
    expect(s.tts.cancels).toBe(1);
    expect(s.sendInterrupt).toHaveBeenCalledOnce();
    expect(s.controller.status).toBe("listening");
    // Stopping the speech mustn't re-trigger a second listen from inside the first.
    expect(s.stt.starts).toBe(2);
  });

  it("a cough or 'mm-hm' only ducks: the reply carries on", async () => {
    const s = setup();
    s.hf.start();
    s.say("hello");
    s.speaker.enqueue("t1", "Hi! How can I help?");
    await s.flush();
    s.vad.speechStart();
    s.clock.advance(COMMIT_MS - 50);
    s.vad.speechEnd(s.clock.now());
    s.clock.advance(1000);
    expect(s.tts.volume).toBe(1);
    expect(s.tts.cancels).toBe(0);
    expect(s.speaker.speaking).toBe(true);
  });

  it("barging in while the agent is still thinking sends interrupt", async () => {
    const s = setup();
    s.hf.start();
    s.say("hello");
    s.busy(true);
    await s.flush();
    s.vad.speechStart();
    s.clock.advance(COMMIT_MS);
    expect(s.sendInterrupt).toHaveBeenCalledOnce();
  });

  it("turns itself off after a long silence", () => {
    const s = setup();
    s.hf.start();
    s.clock.advance(IDLE_MS + 1);
    s.stt.handlers!.onEnd(); // Chrome gave up on silence
    expect(s.hf.on).toBe(false);
    expect(s.stt.starts).toBe(1);
  });

  it("a long reply doesn't count as silence", () => {
    const s = setup();
    s.hf.start();
    s.say("tell me about the menu");
    s.speaker.enqueue("t1", "Our menu has many dishes.");
    s.hf.turnDone();
    s.clock.advance(IDLE_MS + 10_000); // the agent talks for 40 s
    s.tts.end();
    expect(s.hf.on).toBe(true);
    expect(s.stt.starts).toBe(2);
  });
});
