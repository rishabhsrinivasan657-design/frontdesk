import { describe, expect, it } from "vitest";
import { ChatLimits, clientKey, DEFAULT_CHAT_LIMITS } from "./chat-limits.js";
import { createKeyTag, MemoryWindowCounter } from "./window-counter.js";

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
      turnsPerIpPerDay: 60,
      turnsPerSessionPerMinute: 8,
      turnsPerSession: 40,
      turnsPerDay: 200,
    });
  });

  it("keeps one IP, and everyone together, under the free tier's requests per day", () => {
    // A turn can make 2 model calls (tool call, then reply); free-tier Gemini allows 500 a day.
    const RPD = 500;
    const CALLS_PER_TURN = 2;
    expect(DEFAULT_CHAT_LIMITS.turnsPerIpPerDay * CALLS_PER_TURN).toBeLessThanOrEqual(RPD / 4);
    expect(DEFAULT_CHAT_LIMITS.turnsPerDay * CALLS_PER_TURN).toBeLessThan(RPD);
  });

  it("refuses everyone once the global daily budget is spent", async () => {
    const { limits: l } = limits({ turnsPerDay: 2 });
    expect(await l.turn("1.1.1.1", "a")).toBe("ok");
    expect(await l.turn("2.2.2.2", "b")).toBe("ok");
    expect(await l.turn("3.3.3.3", "c")).toBe("busy_today");
  });

  it("a full session stays full after a day (no daily renewal)", async () => {
    const { limits: l, advance } = limits({ turnsPerSession: 2 });
    await l.turn("1.2.3.4", "sess_a");
    await l.turn("1.2.3.4", "sess_a");
    advance(25 * 3_600_000);
    expect(await l.turn("1.2.3.4", "sess_a")).toBe("session_full");
  });

  it("parallel connects can't get past the socket cap", async () => {
    const { limits: l } = limits({ sessionsPerIpPerHour: 100 });
    const verdicts = await Promise.all(Array.from({ length: 6 }, () => l.connect("1.2.3.4")));
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(3);
  });

  it("a refused session gives its socket slot back", async () => {
    const { limits: l } = limits({ sessionsPerIpPerHour: 1, socketsPerIp: 1 });
    expect(await l.connect("1.2.3.4")).toBe("ok");
    l.release("1.2.3.4");
    expect(await l.connect("1.2.3.4")).toBe("too_many_sessions");
    // The refused attempt didn't keep a slot: the socket cap is still free.
    expect(await l.connect("5.6.7.8")).toBe("ok");
  });

  it("IPv6 addresses in one /64 share their limits", async () => {
    const { limits: l } = limits({ socketsPerIp: 1 });
    expect(await l.connect("2001:db8:1:2::a")).toBe("ok");
    expect(await l.connect("2001:db8:1:2:ffff::b")).toBe("too_many_sockets");
    expect(await l.connect("2001:db8:1:3::a")).toBe("ok");
  });

  it("a v4-mapped IPv6 address counts as its IPv4 address", async () => {
    const { limits: l } = limits({ socketsPerIp: 1 });
    expect(await l.connect("::ffff:1.2.3.4")).toBe("ok");
    expect(await l.connect("1.2.3.4")).toBe("too_many_sockets");
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
    const l = new ChatLimits(
      {
        hit: (key) => {
          keys.push(key);
          return Promise.resolve(1);
        },
      },
      DEFAULT_CHAT_LIMITS,
      createKeyTag("server-secret"),
    );
    await l.turn("1.2.3.4", "sess_secret_value");
    expect(keys.join(" ")).not.toContain("sess_secret_value");
    expect(keys.join(" ")).not.toContain("1.2.3.4");
  });
});

describe("createKeyTag", () => {
  it("depends on the server secret, so a tag can't be reversed by hashing every IPv4", () => {
    expect(createKeyTag("a")("1.2.3.4")).not.toBe(createKeyTag("b")("1.2.3.4"));
    expect(createKeyTag("a")("1.2.3.4")).toBe(createKeyTag("a")("1.2.3.4"));
  });
});

describe("clientKey", () => {
  it("normalizes v4-mapped addresses and keeps an IPv6 /64", () => {
    expect(clientKey("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(clientKey("2001:DB8:0:0:1::")).toBe("2001:db8:0:0::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("10.0.0.1")).toBe("10.0.0.1");
  });
});
