import {
  LLMError,
  type LLMChunk,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type Usage,
} from "@frontdesk/core";
import {
  ApiError,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
} from "@google/genai";
import { type ZodType, z } from "zod";
import { parseOutput } from "../output.js";

export type GeminiModels = Pick<GoogleGenAI["models"], "generateContent" | "generateContentStream">;

export interface GeminiProviderOptions {
  model: string;
  apiKey?: string;
  /** Injected SDK client (tests); takes precedence over apiKey. */
  client?: GeminiModels;
  /** Per-request timeout; a stalled call becomes a retryable 504. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** LLMProvider over the official @google/genai SDK (spec §7). */
export class GeminiProvider implements LLMProvider {
  readonly model: string;
  private readonly client: GeminiModels;

  constructor(options: GeminiProviderOptions) {
    this.model = options.model;
    this.client =
      options.client ??
      new GoogleGenAI({
        apiKey: options.apiKey,
        httpOptions: { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      }).models;
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    const params = this.params(req);
    let usage: Usage | undefined;
    let callCount = 0;
    let produced = false;
    let finishReason: string | undefined;
    try {
      const responses = await this.client.generateContentStream(params);
      for await (const response of responses) {
        throwIfBlocked(response);
        finishReason = response.candidates?.[0]?.finishReason ?? finishReason;
        for (const part of partsOf(response)) {
          if (part.thought) continue;
          if (part.functionCall) {
            const call = part.functionCall;
            yield {
              type: "tool_call",
              call: {
                id: call.id ?? `call_${callCount}`,
                name: call.name ?? "",
                args: call.args ?? {},
                ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
              },
            };
            callCount += 1;
            produced = true;
          } else if (part.text) {
            yield { type: "text", text: part.text };
            produced = true;
          }
        }
        usage = usageOf(response) ?? usage;
      }
    } catch (error) {
      throw toLLMError(error);
    }
    // An empty reply (e.g. a safety stop) must surface as an error, never as silence.
    if (!produced) throw emptyResponse(finishReason);
    yield { type: "usage", usage: usage ?? { inputTokens: 0, outputTokens: 0 } };
  }

  async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
    // Built outside the try: a schema that can't become JSON Schema is a local bug, not upstream.
    const params = this.params(req);
    params.config = {
      ...params.config,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(schema),
    };
    let response: GenerateContentResponse;
    try {
      response = await this.client.generateContent(params);
    } catch (error) {
      throw toLLMError(error);
    }
    throwIfBlocked(response);
    const text = partsOf(response)
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("");
    if (!text) throw emptyResponse(response.candidates?.[0]?.finishReason);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new LLMError("invalid_output", `Model output is not JSON: ${text.slice(0, 200)}`, {
        cause: error,
      });
    }
    return {
      value: parseOutput(schema, json),
      usage: usageOf(response) ?? { inputTokens: 0, outputTokens: 0 },
    };
  }

  private params(req: LLMRequest) {
    const config: GenerateContentConfig = { systemInstruction: req.system };
    if (req.temperature !== undefined) config.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) config.maxOutputTokens = req.maxOutputTokens;
    if (req.tools?.length) {
      config.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.parameters,
          })),
        },
      ];
    }
    return { model: this.model, contents: req.messages.map(toContent), config };
  }
}

function toContent(message: LLMMessage): Content {
  switch (message.role) {
    case "user":
      return { role: "user", parts: [{ text: message.text }] };
    case "assistant": {
      const parts: Part[] = message.text ? [{ text: message.text }] : [];
      for (const call of message.toolCalls ?? []) {
        parts.push({
          functionCall: { id: call.id, name: call.name, args: call.args },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        });
      }
      return { role: "model", parts };
    }
    case "tool":
      return {
        role: "user",
        parts: [
          {
            functionResponse: {
              id: message.callId,
              name: message.name,
              response: { result: message.result },
            },
          },
        ],
      };
  }
}

function partsOf(response: GenerateContentResponse): Part[] {
  return response.candidates?.[0]?.content?.parts ?? [];
}

function usageOf(response: GenerateContentResponse): Usage | undefined {
  const meta = response.usageMetadata;
  if (!meta) return undefined;
  return {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
  };
}

function throwIfBlocked(response: GenerateContentResponse): void {
  const reason = response.promptFeedback?.blockReason;
  if (reason) throw new LLMError("upstream", `Gemini blocked the prompt: ${reason}`);
}

function emptyResponse(finishReason: string | undefined): LLMError {
  return new LLMError(
    "upstream",
    `Gemini returned an empty response (finishReason: ${finishReason ?? "none"})`,
  );
}

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);

/** Maps SDK and network failures to LLMError; anything else is a local bug and is rethrown as-is. */
function toLLMError(error: unknown): unknown {
  if (error instanceof LLMError) return error;
  if (error instanceof ApiError) {
    const code = error.status === 429 ? "rate_limited" : "upstream";
    return new LLMError(code, `Gemini API error ${error.status}: ${error.message}`, {
      status: error.status,
      retryAfterMs: retryAfterMs(error.message),
      cause: error,
    });
  }
  // The SDK enforces its timeout by aborting the fetch.
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") {
    return new LLMError("upstream", "Gemini request timed out", { status: 504, cause: error });
  }
  // fetch reports network failures as TypeError; Node socket errors carry an errno code.
  const errno = (error as { code?: unknown } | null)?.code;
  if (error instanceof TypeError || (typeof errno === "string" && NETWORK_CODES.has(errno))) {
    return new LLMError("upstream", `Gemini request failed: ${String(error)}`, {
      status: 503,
      cause: error,
    });
  }
  return error;
}

/** Reads google.rpc.RetryInfo.retryDelay (e.g. "34s") from an API error body. */
function retryAfterMs(message: string): number | undefined {
  let body: unknown;
  try {
    body = JSON.parse(message);
  } catch {
    return undefined;
  }
  const details = (body as { error?: { details?: { retryDelay?: unknown }[] } }).error?.details;
  for (const detail of details ?? []) {
    const match =
      typeof detail.retryDelay === "string" && /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return undefined;
}
