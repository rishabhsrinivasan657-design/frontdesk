import { describe, expect, it } from "vitest";
import {
  COMPLETE_MS,
  Endpointer,
  HARD_CAP_MS,
  INCOMPLETE_MS,
  MAX_CATCHUP_MS,
  NEUTRAL_MS,
  STABLE_MS,
} from "./endpointer";
import { fakeClock } from "./fakes";

function setup() {
  const clock = fakeClock();
  const ended: { text: string; speechEnd: number; at: number }[] = [];
  const gaveUp: number[] = [];
  const ep = new Endpointer({
    timers: clock.timers,
    now: clock.now,
    onEndOfTurn: (text, speechEnd) => ended.push({ text, speechEnd, at: clock.now() }),
    onGiveUp: () => gaveUp.push(clock.now()),
  });
  /** Moves the clock to absolute time `ms`, firing timers on the way. */
  const at = (ms: number) => clock.advance(ms - clock.now());
  return { ep, ended, at, gaveUp };
}

describe("Endpointer", () => {
  it("uses the spec's starting windows", () => {
    expect([COMPLETE_MS, NEUTRAL_MS, INCOMPLETE_MS, HARD_CAP_MS]).toEqual([300, 700, 2000, 3000]);
    expect([STABLE_MS, MAX_CATCHUP_MS]).toEqual([200, 600]);
  });

  it("complete text ends the turn 300 ms after silence", () => {
    const { ep, ended, at } = setup();
    ep.speechStart();
    ep.transcript("yes");
    ep.speechEnd();
    at(299);
    expect(ended).toEqual([]);
    at(300);
    expect(ended).toEqual([{ text: "yes", speechEnd: 0, at: 300 }]);
  });

  it("unfinished text waits 2 s", () => {
    const { ep, ended, at } = setup();
    ep.transcript("a table for");
    ep.speechEnd();
    at(1999);
    expect(ended).toEqual([]);
    at(2000);
    expect(ended.map((e) => e.at)).toEqual([2000]);
  });

  it("neutral text waits 700 ms", () => {
    const { ep, ended, at } = setup();
    ep.transcript("I was wondering about the menu");
    ep.speechEnd();
    at(699);
    expect(ended).toEqual([]);
    at(700);
    expect(ended.map((e) => e.at)).toEqual([700]);
  });

  it("measures the window from when silence began, as the VAD reports it", () => {
    const { ep, ended, at } = setup();
    ep.transcript("yes");
    at(200);
    ep.speechEnd(0);
    at(300);
    expect(ended).toEqual([{ text: "yes", speechEnd: 0, at: 300 }]);
  });

  it("speech resuming cancels the window", () => {
    const { ep, ended, at } = setup();
    ep.transcript("a table for");
    ep.speechEnd();
    at(500);
    ep.speechStart();
    ep.transcript("a table for four people");
    at(900);
    ep.speechEnd();
    at(3000);
    expect(ended).toEqual([{ text: "a table for four people", speechEnd: 900, at: 1600 }]);
  });

  it("words that arrive during the window re-pick it from speechEnd", () => {
    const { ep, ended, at } = setup();
    ep.transcript("a table for");
    ep.speechEnd();
    at(400);
    ep.transcript("a table for four on friday at 7");
    at(699);
    expect(ended).toEqual([]);
    at(700);
    expect(ended.map((e) => [e.text, e.at])).toEqual([["a table for four on friday at 7", 700]]);
  });

  it("waits for late words to settle", () => {
    const { ep, ended, at } = setup();
    ep.transcript("yes");
    ep.speechEnd();
    at(250);
    ep.transcript("yes please");
    at(449);
    expect(ended).toEqual([]);
    at(450);
    expect(ended.map((e) => e.text)).toEqual(["yes please"]);
  });

  it("catch-up is bounded", () => {
    const { ep, ended, at } = setup();
    ep.transcript("yes");
    ep.speechEnd();
    for (let t = 100; t <= 2000 && ended.length === 0; t += 100) {
      at(t);
      ep.transcript(`a table for 4 on friday at 7 ${t}`);
    }
    expect(ended).toHaveLength(1);
    expect(ended[0]!.at).toBe(NEUTRAL_MS + MAX_CATCHUP_MS);
  });

  it("never emits empty text, but words arriving after the window end the turn at once", () => {
    const { ep, ended, at } = setup();
    ep.speechEnd();
    at(HARD_CAP_MS + MAX_CATCHUP_MS);
    expect(ended).toEqual([]);

    const b = setup();
    b.ep.speechEnd();
    b.at(2500);
    b.ep.transcript("yes");
    expect(b.ended.map((e) => [e.text, e.at])).toEqual([["yes", 2500]]);
  });

  it("the hard cap bounds the wait even while words trickle in", () => {
    const { ep, ended, at } = setup();
    ep.transcript("a table for");
    ep.speechEnd();
    for (let t = 1900; t <= 4000 && ended.length === 0; t += 100) {
      at(t);
      ep.transcript(`a table for ${"x ".repeat(t / 100)}and`);
    }
    expect(ended[0]!.at).toBeLessThanOrEqual(HARD_CAP_MS);
  });

  it("adapts to a slow speaker's mid-sentence pauses", () => {
    const { ep, at } = setup();
    expect(ep.neutralMs).toBe(NEUTRAL_MS);
    let t = 0;
    for (const pause of [1000, 1100, 1200]) {
      ep.transcript(`a table ${t} for`);
      ep.speechEnd();
      t += pause;
      at(t);
      ep.speechStart();
      t += 500;
      at(t);
    }
    expect(ep.neutralMs).toBe(1300);
  });

  it("adaptation is bounded at 1.5 s", () => {
    const { ep, at } = setup();
    let t = 0;
    for (const pause of [1800, 1900, 1950]) {
      ep.transcript(`a table ${t} for`);
      ep.speechEnd();
      t += pause;
      at(t);
      ep.speechStart();
      t += 500;
      at(t);
    }
    expect(ep.neutralMs).toBe(1500);
  });

  it("flush emits now, once", () => {
    const { ep, ended, at } = setup();
    ep.speechStart();
    ep.transcript("a table for");
    at(100);
    ep.flush();
    ep.flush();
    at(5000);
    expect(ended).toEqual([{ text: "a table for", speechEnd: 100, at: 100 }]);
  });

  it("flush with nothing heard emits nothing", () => {
    const { ep, ended } = setup();
    ep.flush();
    expect(ended).toEqual([]);
  });

  it("reset forgets text and allows a new emit", () => {
    const { ep, ended, at } = setup();
    ep.transcript("yes");
    ep.speechEnd();
    at(300);
    ep.reset();
    ep.transcript("no");
    ep.speechEnd();
    at(600);
    expect(ended.map((e) => e.text)).toEqual(["yes", "no"]);
  });

  it("a minimum window holds even a complete-sounding turn (no VAD: word gaps aren't silence)", () => {
    const { ep, ended, at } = setup();
    ep.minWindowMs = 1500;
    ep.transcript("yes");
    ep.speechEnd();
    at(1499);
    expect(ended).toEqual([]);
    at(1500);
    expect(ended.map((e) => e.at)).toEqual([1500]);
  });

  it("noise with no words gives up at the hard cap", () => {
    const { ep, ended, at, gaveUp } = setup();
    ep.speechStart();
    ep.speechEnd();
    at(HARD_CAP_MS - 1);
    expect(gaveUp).toEqual([]);
    at(HARD_CAP_MS);
    expect(gaveUp).toEqual([HARD_CAP_MS]);
    expect(ended).toEqual([]);
  });
});
