import { LLMConfigError } from "@frontdesk/llm";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { buildLLM } from "./build.js";
import { ScriptedLLM } from "./scripted.js";

const redis = new Redis({ lazyConnect: true });
afterAll(() => redis.disconnect());

describe("buildLLM", () => {
  it("selects the scripted LLM", () => {
    expect(buildLLM({ LLM_PROVIDER: "scripted" }, redis)).toBeInstanceOf(ScriptedLLM);
  });

  it("refuses Gemini without a key", () => {
    expect(() => buildLLM({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "" }, redis)).toThrow(
      LLMConfigError,
    );
  });
});
