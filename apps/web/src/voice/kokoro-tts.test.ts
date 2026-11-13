import { describe, expect, it } from "vitest";
import { FakeTts } from "./fakes";
import { createConversationTts, createSwitchingTts } from "./kokoro-tts";

function fakeKokoro() {
  const tts = new FakeTts() as FakeTts & { ready: boolean; load(): Promise<void> };
  tts.ready = false;
  // Like the real one: resolves only once the model can speak.
  tts.load = () => (tts.ready ? Promise.resolve() : new Promise(() => {}));
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

describe("createConversationTts", () => {
  const h = { onStart: () => {}, onEnd: () => {} };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("keeps one voice for the whole conversation, even when Kokoro becomes ready", async () => {
    const kokoro = fakeKokoro();
    const fallback = new FakeTts();
    const tts = createConversationTts(kokoro, fallback, 0);
    tts.speak("Hello.", h);
    await flush();
    kokoro.ready = true;
    tts.speak("How can I help?", h);
    await flush();
    expect(fallback.spoken).toEqual(["Hello.", "How can I help?"]);
    expect(kokoro.spoken).toEqual([]);
  });

  it("a new conversation picks again, so Kokoro takes over from the next one", async () => {
    const kokoro = fakeKokoro();
    const fallback = new FakeTts();
    const tts = createConversationTts(kokoro, fallback, 0);
    tts.speak("Hello.", h);
    await flush();
    kokoro.ready = true;
    tts.newConversation();
    tts.speak("Hi again.", h);
    await flush();
    expect(kokoro.spoken).toEqual(["Hi again."]);
  });
});
