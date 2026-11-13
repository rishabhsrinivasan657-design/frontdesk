import { describe, expect, it, vi } from "vitest";
import { WAKE_GIVE_UP_MS, WAKE_HINT_AFTER_MS, healthUrlFor, wakeApi, wakingUp } from "./wake";

describe("healthUrlFor", () => {
  it("turns the chat socket address into the api's health address", () => {
    expect(healthUrlFor("wss://casa-fiorella-api.onrender.com/ws")).toBe(
      "https://casa-fiorella-api.onrender.com/health",
    );
    expect(healthUrlFor("ws://localhost:4000/ws")).toBe("http://localhost:4000/health");
    expect(healthUrlFor("https://casa-fiorella-api.onrender.com")).toBe(
      "https://casa-fiorella-api.onrender.com/health",
    );
  });

  it("returns undefined for something that isn't a URL", () => {
    expect(healthUrlFor("not a url")).toBeUndefined();
  });
});

describe("wakeApi", () => {
  it("pings the health address once", () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response()),
    );
    wakeApi("wss://api.example.com/ws", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.example.com/health");
  });

  it("never throws, even when the ping fails", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("asleep")));
    expect(() => wakeApi("wss://api.example.com/ws", fetchImpl)).not.toThrow();
    await Promise.resolve();
    expect(() => wakeApi("nonsense", fetchImpl)).not.toThrow();
  });
});

describe("wakingUp", () => {
  const after = WAKE_HINT_AFTER_MS;

  it("stays quiet for the first few seconds of an ordinary connect", () => {
    expect(wakingUp("connecting", false, after - 1)).toBe(false);
  });

  it("explains the wait once connecting takes a while", () => {
    expect(wakingUp("connecting", false, after)).toBe(true);
    expect(wakingUp("reconnecting", false, after + 5000)).toBe(true);
  });

  it("covers the give-up state while a cold start could still be running", () => {
    expect(wakingUp("unreachable", false, after + 15_000)).toBe(true);
    expect(wakingUp("unreachable", false, WAKE_GIVE_UP_MS)).toBe(false);
  });

  it("never shows once the chat has connected, or for refusals", () => {
    expect(wakingUp("open", false, after)).toBe(false);
    expect(wakingUp("reconnecting", true, after + 5000)).toBe(false);
    expect(wakingUp("limited", false, after)).toBe(false);
    expect(wakingUp("bot_check_failed", false, after)).toBe(false);
  });
});
