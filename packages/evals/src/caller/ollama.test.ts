import { LLMError } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OllamaProvider } from "./ollama.js";

const REQ = {
  purpose: "turn" as const,
  template: { id: "caller-sim", text: "t" },
  system: "be a caller",
  messages: [{ role: "user" as const, text: "Hello" }],
  temperature: 0.4,
};
const Schema = z.object({ say: z.string(), done: z.boolean() });

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return Promise.resolve(respond());
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const ok = (content: string) =>
  new Response(
    JSON.stringify({
      message: { role: "assistant", content },
      prompt_eval_count: 42,
      eval_count: 7,
    }),
  );

describe("OllamaProvider", () => {
  it("sends the JSON schema as format and maps messages", async () => {
    const f = fakeFetch(() => ok('{"say":"Hi","done":false}'));
    const llm = new OllamaProvider({ model: "gemma3:4b", fetch: f.fetch });
    await llm.generate(REQ, Schema);
    expect(f.calls[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(f.calls[0]!.body).toMatchObject({
      model: "gemma3:4b",
      stream: false,
      format: z.toJSONSchema(Schema),
      options: { temperature: 0.4 },
      messages: [
        { role: "system", content: "be a caller" },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("reports token usage", async () => {
    const llm = new OllamaProvider({
      model: "m",
      fetch: fakeFetch(() => ok('{"say":"Hi","done":true}')).fetch,
    });
    expect(await llm.generate(REQ, Schema)).toEqual({
      value: { say: "Hi", done: true },
      usage: { inputTokens: 42, outputTokens: 7 },
    });
  });

  it("maps a refused connection to upstream", async () => {
    const fetch = (() => Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    const err = await new OllamaProvider({ model: "m", fetch })
      .generate(REQ, Schema)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect((err as LLMError).code).toBe("upstream");
  });

  it("maps an HTTP error to upstream", async () => {
    const f = fakeFetch(() => new Response("model not found", { status: 404 }));
    const err = await new OllamaProvider({ model: "m", fetch: f.fetch })
      .generate(REQ, Schema)
      .catch((e: unknown) => e);
    expect((err as LLMError).code).toBe("upstream");
  });

  it("maps non-JSON or off-schema content to invalid_output", async () => {
    for (const content of ["not json", '{"say":3}']) {
      const f = fakeFetch(() => ok(content));
      const err = await new OllamaProvider({ model: "m", fetch: f.fetch })
        .generate(REQ, Schema)
        .catch((e: unknown) => e);
      expect((err as LLMError).code).toBe("invalid_output");
    }
  });

  it("does not support streaming", async () => {
    const llm = new OllamaProvider({ model: "m", fetch: fakeFetch(() => ok("")).fetch });
    const it = llm.stream(REQ)[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toMatchObject({ code: "config" });
  });
});
