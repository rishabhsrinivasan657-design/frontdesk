import type { ZodType } from "zod";

/** Read tools run immediately; write tools only create a pending action (spec §6). */
export type ToolEffect = "read" | "write";

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
  effect: ToolEffect;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Opaque provider token that must be sent back with this call (Gemini thought signature). */
  signature?: string;
}

export type LLMMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: unknown };

export type LLMPurpose = "turn" | "confirmation" | "grounding" | "summary";

export interface LLMRequest {
  purpose: LLMPurpose;
  /** The unrendered prompt template; recordings hash it to detect staleness. */
  template: { id: string; text: string };
  system: string;
  messages: LLMMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type LLMChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; usage: Usage };

export interface LLMProvider {
  readonly model: string;
  stream(req: LLMRequest): AsyncIterable<LLMChunk>;
  generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }>;
}
