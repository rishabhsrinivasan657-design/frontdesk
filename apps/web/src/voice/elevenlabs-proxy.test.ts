import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxyTts, resetUsage } from "./elevenlabs-proxy";

const env = { ELEVENLABS_API_KEY: "k", ELEVENLABS_MONTHLY_CHARS: "20" };
const ours = { origin: "https://casa.example", host: "casa.example" };
const audio = () => vi.fn(() => Promise.resolve(new Response("mp3", { status: 200 })));

beforeEach(() => resetUsage());

describe("proxyTts", () => {
  it("is off without a key", async () => {
    expect((await proxyTts({ text: "Hi.", ...ours }, {}, audio())).status).toBe(404);
  });

  it("only our own page can use it", async () => {
    const res = await proxyTts(
      { text: "Hi.", origin: "https://evil.example", host: "casa.example" },
      env,
      audio(),
    );
    expect(res.status).toBe(403);
  });

  it("returns the audio, with the key only in the upstream request", async () => {
    const f = audio();
    const res = await proxyTts({ text: "Hello there.", ...ours }, env, f);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(await res.text()).toBe("mp3");
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
  });

  it("stops at the monthly cap, so the free credits are never exceeded", async () => {
    const f = audio();
    expect((await proxyTts({ text: "Twelve chars", ...ours }, env, f)).status).toBe(200);
    expect((await proxyTts({ text: "Twelve chars", ...ours }, env, f)).status).toBe(429);
    expect(f).toHaveBeenCalledOnce();
  });
});
