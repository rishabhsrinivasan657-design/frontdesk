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
}

/** LLMProvider over the official @google/genai SDK (spec §7). */
export class GeminiProvider implements LLMProvider {
  readonly model: string;
  private readonly client: GeminiModels;

  constructor(options: GeminiProviderOptions) {
    this.model = options.model;
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey }).models;
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    let usage: Usage | undefined;
    let callCount = 0;
    try {
      const responses = await this.client.generateContentStream(this.params(req));
      for await (const response of responses) {
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
          } else if (part.text) {
            yield { type: "text", text: part.text };
          }
        }
        usage = usageOf(response) ?? usage;
      }
    } catch (error) {
      throw toLLMError(error);
    }
    yield { type: "usage", usage: usage ?? { inputTokens: 0, outputTokens: 0 } };
  }

  async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
    let response: GenerateContentResponse;
    try {
      const params = this.params(req);
      params.config = {
        ...params.config,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(schema),
      };
      response = await this.client.generateContent(params);
    } catch (error) {
      throw toLLMError(error);
    }
    const text = partsOf(response)
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("");
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

function toLLMError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof ApiError) {
    const code = error.status === 429 ? "rate_limited" : "upstream";
    return new LLMError(code, `Gemini API error ${error.status}: ${error.message}`, {
      status: error.status,
      cause: error,
    });
  }
  // Network-level failures (fetch TypeError, resets) are treated as a retryable 503.
  return new LLMError("upstream", `Gemini request failed: ${String(error)}`, {
    status: 503,
    cause: error,
  });
}
