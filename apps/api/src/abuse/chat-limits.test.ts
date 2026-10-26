import { describe, expect, it } from "vitest";
import { ChatLimits, DEFAULT_CHAT_LIMITS } from "./chat-limits.js";
import { MemoryWindowCounter } from "./window-counter.js";

function limits(overrides: Partial<typeof DEFAULT_CHAT_LIMITS> = {}) {
  let now = 0;
  const counter = new MemoryWindowCounter(() => now);
  return {
    limits: new ChatLimits(counter, { ...DEFAULT_CHAT_LIMITS, ...overrides }),
    advance: (ms: number) => (now += ms),
  };
}

describe("ChatLimits", () => {
  it("has the pilot defaults", () => {
    expect(DEFAULT_CHAT_LIMITS).toEqual({
      sessionsPerIpPerHour: 10,
      socketsPerIp: 3,
      turnsPerIpPerDay: 300,
      turnsPerSessionPerMinute: 8,
      turnsPerSession: 40,
    });
  });

  it("refuses the 11th session from one IP within an hour", async () => {
    const { limits: l, advance } = limits({ socketsPerIp: 100 });
    for (let i = 0; i < 10; i++) expect(await l.connect("1.2.3.4")).toBe("ok");
    expect(await l.connect("1.2.3.4")).toBe("too_many_sessions");
    expect(await l.connect("5.6.7.8")).toBe("ok");
    advance(3_600_000);
    expect(await l.connect("1.2.3.4")).toBe("ok");
  });

  it("refuses a 4th open socket and frees a slot on release", async () => {
    const { limits: l } = limits();
    for (let i = 0; i < 3; i++) expect(await l.connect("1.2.3.4")).toBe("ok");
    expect(await l.connect("1.2.3.4")).toBe("too_many_sockets");
    l.release("1.2.3.4");
    expect(await l.connect("1.2.3.4")).toBe("ok");
  });

  it("9th turn in a minute is slow_down", async () => {
    const { limits: l, advance } = limits();
    for (let i = 0; i < 8; i++) expect(await l.turn("1.2.3.4", "sess_a")).toBe("ok");
    expect(await l.turn("1.2.3.4", "sess_a")).toBe("slow_down");
    advance(60_000);
    expect(await l.turn("1.2.3.4", "sess_a")).toBe("ok");
  });

  it("41st turn is session_full", async () => {
    const { limits: l, advance } = limits();
    for (let i = 0; i < 40; i++) {
      expect(await l.turn("1.2.3.4", "sess_a")).toBe("ok");
      advance(10_000);
    }
    expect(await l.turn("1.2.3.4", "sess_a")).toBe("session_full");
  });

  it("caps one IP's turns per day across sessions", async () => {
    const { limits: l } = limits({ turnsPerIpPerDay: 3 });
    expect(await l.turn("1.2.3.4", "s1")).toBe("ok");
    expect(await l.turn("1.2.3.4", "s2")).toBe("ok");
    expect(await l.turn("1.2.3.4", "s3")).toBe("ok");
    expect(await l.turn("1.2.3.4", "s4")).toBe("daily_limit");
  });

  it("never puts a session id in a counter key", async () => {
    const keys: string[] = [];
    const l = new ChatLimits({
      hit: (key) => {
        keys.push(key);
        return Promise.resolve(1);
      },
    });
    await l.turn("1.2.3.4", "sess_secret_value");
    expect(keys.join(" ")).not.toContain("sess_secret_value");
  });
});
