import { describe, expect, it } from "vitest";
import { FakeTts, fakeClock } from "./fakes";
import { FILLER_DELAY_MS, FILLER_TURN, Filler } from "./filler";
import { Speaker } from "./speaker";

function setup() {
  const clock = fakeClock();
  const tts = new FakeTts();
  const speaker = new Speaker(tts, { onTtsStarted: () => {}, onChange: () => {} });
  const filler = new Filler({ speaker, timers: clock.timers });
  return { clock, tts, speaker, filler };
}

describe("Filler", () => {
  it("says a short acknowledgement when the reply is slow, locally only", () => {
    const s = setup();
    s.filler.sent();
    s.clock.advance(FILLER_DELAY_MS - 1);
    expect(s.tts.spoken).toEqual([]);
    s.clock.advance(1);
    expect(s.tts.spoken).toHaveLength(1);
    expect(FILLER_TURN).toBe("filler");
  });

  it("stays quiet when the reply comes in time", () => {
    const s = setup();
    s.filler.sent();
    s.clock.advance(FILLER_DELAY_MS - 100);
    s.filler.replied();
    s.clock.advance(5000);
    expect(s.tts.spoken).toEqual([]);
  });
});
