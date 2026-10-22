import { resolve } from "node:path";
import type { LLMChunk, LLMRequest, ToolCall, ToolSpec } from "@frontdesk/core";
import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collect } from "../test-request.js";
import { GeminiProvider } from "./gemini.js";

// Live Gemini smoke test: runs only via `pnpm test:live` (LLM_LIVE=1) with GEMINI_API_KEY in .env.
config({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });
const enabled = process.env.LLM_LIVE === "1" && Boolean(process.env.GEMINI_API_KEY);
const model = process.env.LLM_MODEL || "gemini-3.5-flash-lite";

const getTime: ToolSpec = {
  name: "get_time",
  description: "Returns the current local time at the restaurant.",
  parameters: { type: "object", properties: {} },
  effect: "read",
};

function request(overrides: Partial<LLMRequest>): LLMRequest {
  return {
    purpose: "turn",
    template: { id: "live-smoke", text: "live smoke" },
    system: "You are a terse test assistant.",
    messages: [],
    temperature: 0,
    maxOutputTokens: 256,
    ...overrides,
  };
}

const text = (chunks: LLMChunk[]) =>
  chunks.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");

describe.skipIf(!enabled)(`gemini live (${model})`, () => {
  const provider = new GeminiProvider({ model, apiKey: process.env.GEMINI_API_KEY });

  it("streams a short reply", async () => {
    const chunks = await collect(
      provider.stream(request({ messages: [{ role: "user", text: "Say hello in three words." }] })),
    );
    expect(text(chunks).length).toBeGreaterThan(0);
    const usage = chunks.find((c) => c.type === "usage");
    expect(usage?.type === "usage" && usage.usage.inputTokens).toBeGreaterThan(0);
  });

  it("generate returns a schema-valid object", async () => {
    const { value } = await provider.generate(
      request({ messages: [{ role: "user", text: "Is water wet? Answer yes or no." }] }),
      z.object({ answer: z.enum(["yes", "no"]) }),
    );
    expect(["yes", "no"]).toContain(value.answer);
  });

  it("tool call round-trip", async () => {
    const base = request({
      system: "Always call get_time before answering any question about time.",
      tools: [getTime],
      messages: [{ role: "user", text: "What time is it at the restaurant?" }],
    });
    const first = await collect(provider.stream(base));
    const calls = first.flatMap<ToolCall>((c) => (c.type === "tool_call" ? [c.call] : []));
    expect(calls.map((c) => c.name)).toContain("get_time");

    const second = await collect(
      provider.stream({
        ...base,
        messages: [
          ...base.messages,
          { role: "assistant", text: text(first), toolCalls: calls },
          ...calls.map((c) => ({
            role: "tool" as const,
            callId: c.id,
            name: c.name,
            result: "19:30",
          })),
        ],
      }),
    );
    expect(text(second)).toMatch(/7:30|19:30/);
  });
});
