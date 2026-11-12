import { describe, expect, it, vi } from "vitest";
import { TurnstileTokens, type TurnstileApi } from "./turnstile";

type Failure = "error" | "timeout" | "unsupported" | "expired";

function fakeApi() {
  let o: Parameters<TurnstileApi["render"]>[1] | undefined;
  let resets = 0;
  const api: TurnstileApi = {
    render: (_el, opts) => {
      o = opts;
      return "w1";
    },
    reset: () => void resets++,
  };
  return {
    api,
    solve: (t: string) => o?.callback(t),
    fail: (kind: Failure) => o?.[`${kind}-callback`]?.(),
    resets: () => resets,
  };
}

describe("TurnstileTokens", () => {
  it("resolves once the widget is solved", async () => {
    const f = fakeApi();
    const tokens = new TurnstileTokens(f.api, {} as HTMLElement, "site");
    const next = tokens.next();
    f.solve("t1");
    expect(await next).toBe("t1");
  });

  it("a token solved early is handed to the first caller", async () => {
    const f = fakeApi();
    const tokens = new TurnstileTokens(f.api, {} as HTMLElement, "site");
    f.solve("early");
    expect(await tokens.next()).toBe("early");
  });

  it("never hands out the same token twice and resets for a new one", async () => {
    const f = fakeApi();
    const tokens = new TurnstileTokens(f.api, {} as HTMLElement, "site");
    f.solve("t1");
    expect(await tokens.next()).toBe("t1");
    const second = tokens.next();
    expect(f.resets()).toBe(1);
    f.solve("t2");
    expect(await second).toBe("t2");
  });

  it("retries once after an error, then resolves", async () => {
    const f = fakeApi();
    const onFailed = vi.fn();
    const tokens = new TurnstileTokens(f.api, {} as HTMLElement, "site", onFailed);
    const next = tokens.next();
    f.fail("error");
    expect(f.resets()).toBe(1);
    f.solve("t1");
    expect(await next).toBe("t1");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("rejects and reports after two failures", async () => {
    const f = fakeApi();
    const onFailed = vi.fn();
    const tokens = new TurnstileTokens(f.api, {} as HTMLElement, "site", onFailed);
    const next = tokens.next();
    f.fail("error");
    f.fail("timeout");
    await expect(next).rejects.toThrow("turnstile failed");
    expect(onFailed).toHaveBeenCalledTimes(1);
    await expect(tokens.next()).rejects.toThrow("turnstile failed");
  });

  it("unsupported fails at once", async () => {
    const f = fakeApi();
    const onFailed = vi.fn();
    const tokens = new TurnstileTokens(f.api, {} as HTMLElement, "site", onFailed);
    const next = tokens.next();
    f.fail("unsupported");
    await expect(next).rejects.toThrow("turnstile failed");
    expect(f.resets()).toBe(0);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("an expired unused token is not handed out", async () => {
    const f = fakeApi();
    const tokens = new TurnstileTokens(f.api, {} as HTMLElement, "site");
    f.solve("old");
    f.fail("expired");
    const next = tokens.next();
    f.solve("new");
    expect(await next).toBe("new");
  });
});
