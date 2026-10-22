import type { LLMRequest } from "@frontdesk/core";

/** A minimal request for tests; override any field. */
export function testRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    purpose: "turn",
    template: { id: "test", text: "You are a test." },
    system: "You are a test.",
    messages: [{ role: "user", text: "hi" }],
    ...overrides,
  };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
