import { describe, expect, it, vi } from "vitest";
import { type StreamLike, connectLive } from "./live-connection";

class FakeStream implements StreamLike {
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, (m: MessageEvent<string>) => void>();
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

function harness(session: "ok" | "unauthorized" | "unreachable" = "ok") {
  const streams: FakeStream[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const o = {
    open: () => {
      const s = new FakeStream();
      streams.push(s);
      return s;
    },
    checkSession: vi.fn(() => Promise.resolve(session)),
    onEvent: vi.fn(),
    onOpen: vi.fn(),
    onStatus: vi.fn(),
    onUnauthorized: vi.fn(),
    schedule: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return () => undefined;
    },
  };
  const stop = connectLive(o);
  const runTimer = async () => {
    timers.shift()!.fn();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { o, streams, timers, runTimer, stop };
}

describe("connectLive", () => {
  it("resyncs on open and forwards events", () => {
    const h = harness();
    h.streams[0]!.onopen!(new Event("open"));
    expect(h.o.onOpen).toHaveBeenCalledTimes(1);
    expect(h.o.onStatus).toHaveBeenLastCalledWith("live");
    h.streams[0]!.emit("turn", { type: "turn", sessionId: "s1" });
    expect(h.o.onEvent).toHaveBeenCalledWith({ type: "turn", sessionId: "s1" });
  });

  it("leaves a dropped-but-retrying stream to the browser", () => {
    const h = harness();
    h.streams[0]!.readyState = 0; // CONNECTING: EventSource retries by itself
    h.streams[0]!.onerror!(new Event("error"));
    expect(h.o.onStatus).toHaveBeenLastCalledWith("reconnecting");
    expect(h.timers).toHaveLength(0);
  });

  it("reopens a stream the browser gave up on, with growing backoff", async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      const s = h.streams.at(-1)!;
      s.readyState = 2; // CLOSED: e.g. the api restarted and answered 502
      s.onerror!(new Event("error"));
      expect(s.closed).toBe(true);
      await h.runTimer();
    }
    expect(h.streams).toHaveLength(4);
    expect(h.o.checkSession).toHaveBeenCalledTimes(3);
  });

  it("backs off 1 s, 2 s, 4 s … up to 15 s, and resets after a good open", async () => {
    const h = harness();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      h.streams.at(-1)!.readyState = 2;
      h.streams.at(-1)!.onerror!(new Event("error"));
      delays.push(h.timers[0]!.ms);
      await h.runTimer();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    h.streams.at(-1)!.onopen!(new Event("open"));
    h.streams.at(-1)!.readyState = 2;
    h.streams.at(-1)!.onerror!(new Event("error"));
    expect(h.timers[0]!.ms).toBe(1000);
  });

  it("sends the owner to login when the session has expired", async () => {
    const h = harness("unauthorized");
    h.streams[0]!.readyState = 2;
    h.streams[0]!.onerror!(new Event("error"));
    await h.runTimer();
    expect(h.o.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(h.streams).toHaveLength(1);
  });

  it("stops for good when stopped", async () => {
    const h = harness();
    h.streams[0]!.readyState = 2;
    h.streams[0]!.onerror!(new Event("error"));
    h.stop();
    await h.runTimer();
    expect(h.streams).toHaveLength(1);
  });
});
