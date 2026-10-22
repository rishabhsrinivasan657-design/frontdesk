import { LLMError, type LLMChunk } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collect, testRequest } from "../test-request.js";
import { FakeProvider } from "./fake.js";

const chunks: LLMChunk[] = [
  { type: "text", text: "Hello" },
  { type: "tool_call", call: { id: "c1", name: "lookup_faq", args: { query: "parking" } } },
  { type: "usage", usage: { inputTokens: 3, outputTokens: 2 } },
];
const Answer = z.object({ answer: z.enum(["yes", "no"]) });

describe("FakeProvider", () => {
  it("streams scripted chunks in order", async () => {
    const fake = new FakeProvider([{ stream: chunks }]);
    expect(await collect(fake.stream(testRequest()))).toEqual(chunks);
  });

  it("generate returns the parsed value and usage", async () => {
    const fake = new FakeProvider([{ generate: { answer: "yes" } }]);
    expect(await fake.generate(testRequest(), Answer)).toEqual({
      value: { answer: "yes" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("generate rejects a value failing the schema with invalid_output", async () => {
    const fake = new FakeProvider([{ generate: { answer: "maybe" } }]);
    await expect(fake.generate(testRequest(), Answer)).rejects.toMatchObject({
      code: "invalid_output",
      retryable: false,
    });
  });

  it("error step throws after afterChunks", async () => {
    const error = new LLMError("upstream", "down", { status: 503 });
    const fake = new FakeProvider([{ error, afterChunks: [{ type: "text", text: "Hel" }] }]);
    const seen: LLMChunk[] = [];
    await expect(async () => {
      for await (const c of fake.stream(testRequest())) seen.push(c);
    }).rejects.toBe(error);
    expect(seen).toEqual([{ type: "text", text: "Hel" }]);
  });

  it("error step rejects generate", async () => {
    const error = new LLMError("upstream", "down", { status: 500 });
    const fake = new FakeProvider([{ error }]);
    await expect(fake.generate(testRequest(), Answer)).rejects.toBe(error);
  });

  it("records every call", async () => {
    const fake = new FakeProvider([{ stream: [] }, { generate: { answer: "no" } }]);
    const req = testRequest();
    await collect(fake.stream(req));
    await fake.generate(req, Answer);
    expect(fake.calls).toEqual([
      { mode: "stream", req },
      { mode: "generate", req },
    ]);
  });

  it("throws when the script is exhausted", async () => {
    const fake = new FakeProvider([]);
    await expect(collect(fake.stream(testRequest()))).rejects.toThrow(/FakeProvider: .*step 0/);
  });

  it("throws on a mode mismatch", async () => {
    const fake = new FakeProvider([{ generate: { answer: "yes" } }]);
    await expect(collect(fake.stream(testRequest()))).rejects.toThrow(/FakeProvider: .*step 0/);
  });
});
