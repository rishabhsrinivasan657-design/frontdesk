import { describe, expect, it } from "vitest";
import { TurnstileTokens, type TurnstileApi } from "./turnstile";

function fakeApi() {
  let callback: ((token: string) => void) | undefined;
  let resets = 0;
  const api: TurnstileApi = {
    render: (_el, o) => {
      callback = o.callback;
      return "w1";
    },
    reset: () => void resets++,
  };
  return { api, solve: (t: string) => callback?.(t), resets: () => resets };
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
});
