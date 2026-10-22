import { describe, expect, it } from "vitest";
import { LLMError } from "./errors.js";

describe("LLMError", () => {
  it("429 and 503 are retryable, 400 is not, no status is not", () => {
    expect(new LLMError("rate_limited", "x", { status: 429 }).retryable).toBe(true);
    expect(new LLMError("upstream", "x", { status: 503 }).retryable).toBe(true);
    expect(new LLMError("upstream", "x", { status: 400 }).retryable).toBe(false);
    expect(new LLMError("spend_cap", "x").retryable).toBe(false);
  });

  it("name is LLMError and instanceof works", () => {
    const e = new LLMError("upstream", "boom", { status: 500, retryAfterMs: 10 });
    expect(e).toBeInstanceOf(LLMError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LLMError");
    expect(e.code).toBe("upstream");
    expect(e.status).toBe(500);
    expect(e.retryAfterMs).toBe(10);
  });
});
