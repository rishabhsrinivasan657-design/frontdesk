import { describe, expect, it } from "vitest";
import { FakeTts } from "./fakes";
import { createSwitchingTts } from "./kokoro-tts";

function fakeKokoro() {
  const tts = new FakeTts() as FakeTts & { ready: boolean; load(): Promise<void> };
  tts.ready = false;
  tts.load = () => Promise.resolve();
  return tts;
}

describe("createSwitchingTts", () => {
  it("speaks with the browser voice until Kokoro is ready, then with Kokoro", () => {
    const kokoro = fakeKokoro();
    const browser = new FakeTts();
    const tts = createSwitchingTts(kokoro, browser);
    const h = { onStart: () => {}, onEnd: () => {} };
    tts.speak("Hello.", h);
    kokoro.ready = true;
    tts.speak("How can I help?", h);
    expect(browser.spoken).toEqual(["Hello."]);
    expect(kokoro.spoken).toEqual(["How can I help?"]);
  });

  it("barge-in cancels both voices", () => {
    const kokoro = fakeKokoro();
    const browser = new FakeTts();
    createSwitchingTts(kokoro, browser).cancel();
    expect([kokoro.cancels, browser.cancels]).toEqual([1, 1]);
  });
});
