import {
  LLMError,
  type LLMChunk,
  type LLMProvider,
  type LLMRequest,
  type Usage,
} from "@frontdesk/core";
import { type ZodType, z } from "zod";

export interface OllamaProviderOptions {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

interface ChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** A local Ollama model behind the LLMProvider interface; the eval caller only needs `generate`. */
export class OllamaProvider implements LLMProvider {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: OllamaProviderOptions) {
    this.model = options.model;
    this.baseUrl = options.baseUrl ?? "http://localhost:11434";
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    await Promise.resolve();
    throw new LLMError("config", `OllamaProvider supports generate only (${req.template.id})`);
  }

  async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
    const body = {
      model: this.model,
      stream: false,
      format: z.toJSONSchema(schema),
      options: { temperature: req.temperature },
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) =>
          m.role === "tool"
            ? { role: "tool", content: JSON.stringify(m.result) }
            : { role: m.role, content: m.text },
        ),
      ],
    };
    let data: ChatResponse;
    try {
      const res = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        throw new LLMError("upstream", `Ollama ${res.status}: ${await res.text()}`, {
          status: res.status,
        });
      }
      data = (await res.json()) as ChatResponse;
    } catch (error) {
      if (error instanceof LLMError) throw error;
      throw new LLMError("upstream", `Ollama unreachable at ${this.baseUrl}: ${String(error)}`, {
        cause: error,
      });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(data.message?.content ?? "");
    } catch (error) {
      throw new LLMError("invalid_output", "Ollama reply is not JSON", { cause: error });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new LLMError(
        "invalid_output",
        `Ollama reply failed the schema:\n${z.prettifyError(parsed.error)}`,
      );
    }
    return {
      value: parsed.data,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
    };
  }
}
