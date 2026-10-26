import { describe, expect, it, vi } from "vitest";
import { SITEVERIFY_URL, TurnstileBotCheck } from "./bot-check.js";

function fakeFetch(body: unknown, ok = true) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 500 })),
  );
}

const check = (fetch: ReturnType<typeof fakeFetch>) =>
  new TurnstileBotCheck({ secret: "s3cret", hostnames: ["casa.duckdns.org"], fetch });

describe("TurnstileBotCheck", () => {
  it("true only for success with an allowed hostname", async () => {
    expect(
      await check(fakeFetch({ success: true, hostname: "casa.duckdns.org" })).verify(
        "t",
        "1.2.3.4",
      ),
    ).toBe(true);
    expect(
      await check(fakeFetch({ success: true, hostname: "evil.example" })).verify("t", "1.2.3.4"),
    ).toBe(false);
    expect(
      await check(fakeFetch({ success: false, hostname: "casa.duckdns.org" })).verify(
        "t",
        "1.2.3.4",
      ),
    ).toBe(false);
  });

  it("false on network error or a bad response", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("offline")));
    expect(await check(failing as never).verify("t", "1.2.3.4")).toBe(false);
    expect(await check(fakeFetch({}, false)).verify("t", "1.2.3.4")).toBe(false);
    expect(await check(fakeFetch("not json")).verify("t", "1.2.3.4")).toBe(false);
  });

  it("false for an empty or oversized token without calling Cloudflare", async () => {
    const fetch = fakeFetch({ success: true, hostname: "casa.duckdns.org" });
    expect(await check(fetch).verify("", "1.2.3.4")).toBe(false);
    expect(await check(fetch).verify("x".repeat(2049), "1.2.3.4")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts secret, response and remoteip as form data", async () => {
    const fetch = fakeFetch({ success: true, hostname: "casa.duckdns.org" });
    await check(fetch).verify("tok", "1.2.3.4");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe("POST");
    const form = new URLSearchParams(init?.body as string);
    expect(Object.fromEntries(form)).toEqual({
      secret: "s3cret",
      response: "tok",
      remoteip: "1.2.3.4",
    });
  });
});
