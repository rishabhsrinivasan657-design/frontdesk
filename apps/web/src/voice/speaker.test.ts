import { describe, expect, it } from "vitest";
import { FakeTts } from "./fakes";
import { Speaker } from "./speaker";

function setup() {
  const tts = new FakeTts();
  let t = 0;
  const started: [string, number, number][] = [];
  const changes: boolean[] = [];
  const speaker = new Speaker(tts, {
    onTtsStarted: (turnId, at, since) => started.push([turnId, at, since]),
    onChange: (speaking) => changes.push(speaking),
    now: () => t,
  });
  return { tts, speaker, started, changes, at: (ms: number) => (t = ms) };
}

describe("Speaker", () => {
  it("speaks sentences in order, one at a time", () => {
    const { tts, speaker } = setup();
    speaker.enqueue("turn_1", "Hello there.");
    speaker.enqueue("turn_1", "Table for 4?");
    expect(tts.spoken).toEqual(["Hello there."]);
    expect(speaker.speaking).toBe(true);
    tts.start();
    tts.end();
    expect(tts.spoken).toEqual(["Hello there.", "Table for 4?"]);
    tts.start();
    tts.end();
    expect(speaker.speaking).toBe(false);
  });

  it("fires onTtsStarted once per turn, timed from the turn's first sentence", () => {
    const { tts, speaker, started, at } = setup();
    at(100);
    speaker.enqueue("turn_1", "One.");
    speaker.enqueue("turn_1", "Two.");
    at(240);
    tts.start();
    tts.end();
    tts.start();
    tts.end();
    at(500);
    speaker.enqueue("turn_2", "Three.");
    at(520);
    tts.start();
    expect(started).toEqual([
      ["turn_1", 240, 140],
      ["turn_2", 520, 20],
    ]);
  });

  it("stop cancels, drops the queue and mutes later sentences", () => {
    const { tts, speaker, changes } = setup();
    speaker.enqueue("turn_1", "One.");
    speaker.enqueue("turn_1", "Two.");
    tts.start();
    speaker.stop();
    expect(tts.cancels).toBe(1);
    expect(speaker.speaking).toBe(false);
    speaker.enqueue("turn_1", "Three.");
    expect(tts.spoken).toEqual(["One."]);
    expect(changes.at(-1)).toBe(false);
  });

  it("unmute speaks the next turn", () => {
    const { tts, speaker } = setup();
    speaker.enqueue("turn_1", "One.");
    speaker.stop();
    speaker.unmute();
    speaker.enqueue("turn_2", "Fresh.");
    expect(tts.spoken).toEqual(["One.", "Fresh."]);
  });
});
