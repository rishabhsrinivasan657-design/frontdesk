import type { LLMRequest, ToolSpec } from "@frontdesk/core";
import {
  ApiError,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collect, testRequest } from "../test-request.js";
import { type GeminiModels, GeminiProvider } from "./gemini.js";

type Part = NonNullable<
  NonNullable<GenerateContentResponse["candidates"]>[number]["content"]
>["parts"];

function response(parts: Part, usage?: GenerateContentResponse["usageMetadata"]) {
  return {
    candidates: [{ content: { role: "model", parts } }],
    usageMetadata: usage,
  } as GenerateContentResponse;
}

/** Fake SDK client: records params, replays canned responses or throws. */
function fakeClient(script: {
  stream?: GenerateContentResponse[];
  generate?: GenerateContentResponse;
  error?: Error;
}) {
  const params: GenerateContentParameters[] = [];
  const client: GeminiModels = {
    generateContent: (p) => {
      params.push(p);
      return script.error ? Promise.reject(script.error) : Promise.resolve(script.generate!);
    },
    generateContentStream: (p) => {
      params.push(p);
      if (script.error) return Promise.reject(script.error);
      return Promise.resolve(
        (async function* () {
          await Promise.resolve();
          yield* script.stream ?? [];
        })(),
      );
    },
  };
  return { client, params };
}

const lookupFaq: ToolSpec = {
  name: "lookup_faq",
  description: "Look up an FAQ answer",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  effect: "read",
};

describe("GeminiProvider", () => {
  it("maps a multi-turn request with tool history to contents", async () => {
    const { client, params } = fakeClient({ stream: [] });
    const req: LLMRequest = testRequest({
      system: "Be brief.",
      temperature: 0.2,
      maxOutputTokens: 256,
      tools: [lookupFaq],
      messages: [
        { role: "user", text: "Is there parking?" },
        {
          role: "assistant",
          text: "",
          toolCalls: [
            { id: "c1", name: "lookup_faq", args: { query: "parking" }, signature: "sig-1" },
          ],
        },
        { role: "tool", callId: "c1", name: "lookup_faq", result: { answer: "Street parking." } },
        { role: "assistant", text: "Street parking." },
      ],
    });
    await collect(new GeminiProvider({ model: "m", client }).stream(req));

    expect(params[0]).toEqual({
      model: "m",
      contents: [
        { role: "user", parts: [{ text: "Is there parking?" }] },
        {
          role: "model",
          parts: [
            {
              functionCall: { id: "c1", name: "lookup_faq", args: { query: "parking" } },
              thoughtSignature: "sig-1",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "c1",
                name: "lookup_faq",
                response: { result: { answer: "Street parking." } },
              },
            },
          ],
        },
        { role: "model", parts: [{ text: "Street parking." }] },
      ],
      config: {
        systemInstruction: "Be brief.",
        temperature: 0.2,
        maxOutputTokens: 256,
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookup_faq",
                description: "Look up an FAQ answer",
                parametersJsonSchema: lookupFaq.parameters,
              },
            ],
          },
        ],
      },
    });
  });

  it("streams text, tool calls and one final usage chunk", async () => {
    const { client } = fakeClient({
      stream: [
        response([{ text: "Let me " }], { promptTokenCount: 5, candidatesTokenCount: 1 }),
        response(
          [
            { text: "check." },
            {
              functionCall: { id: "x9", name: "lookup_faq", args: { query: "kids" } },
              thoughtSignature: "sig",
            },
          ],
          { promptTokenCount: 5, candidatesTokenCount: 4 },
        ),
      ],
    });
    const out = await collect(new GeminiProvider({ model: "m", client }).stream(testRequest()));
    expect(out).toEqual([
      { type: "text", text: "Let me " },
      { type: "text", text: "check." },
      {
        type: "tool_call",
        call: { id: "x9", name: "lookup_faq", args: { query: "kids" }, signature: "sig" },
      },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 4 } },
    ]);
  });

  it("skips thought-summary parts", async () => {
    const { client } = fakeClient({
      stream: [response([{ text: "thinking…", thought: true }, { text: "Hi" }])],
    });
    const out = await collect(new GeminiProvider({ model: "m", client }).stream(testRequest()));
    expect(out.filter((c) => c.type === "text")).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("assigns call ids when Gemini omits them", async () => {
    const { client } = fakeClient({
      stream: [
        response([{ functionCall: { name: "a", args: {} } }, { functionCall: { name: "b" } }]),
      ],
    });
    const out = await collect(new GeminiProvider({ model: "m", client }).stream(testRequest()));
    expect(out.filter((c) => c.type === "tool_call")).toEqual([
      { type: "tool_call", call: { id: "call_0", name: "a", args: {} } },
      { type: "tool_call", call: { id: "call_1", name: "b", args: {} } },
    ]);
  });

  it("counts thinking tokens as output", async () => {
    const { client } = fakeClient({
      stream: [
        response([{ text: "ok" }], {
          promptTokenCount: 7,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 30,
        }),
      ],
    });
    const out = await collect(new GeminiProvider({ model: "m", client }).stream(testRequest()));
    expect(out.at(-1)).toEqual({ type: "usage", usage: { inputTokens: 7, outputTokens: 32 } });
  });

  const Answer = z.object({ answer: z.enum(["yes", "no"]) });

  it("generate sends the JSON schema and returns the parsed value", async () => {
    const { client, params } = fakeClient({
      generate: response([{ text: '{"answer":' }, { text: '"yes"}' }], {
        promptTokenCount: 9,
        candidatesTokenCount: 3,
      }),
    });
    const result = await new GeminiProvider({ model: "m", client }).generate(testRequest(), Answer);
    expect(result).toEqual({
      value: { answer: "yes" },
      usage: { inputTokens: 9, outputTokens: 3 },
    });
    expect(params[0]?.config).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(Answer),
    });
  });

  it("generate throws invalid_output for non-JSON", async () => {
    const { client } = fakeClient({ generate: response([{ text: "yes" }]) });
    await expect(
      new GeminiProvider({ model: "m", client }).generate(testRequest(), Answer),
    ).rejects.toMatchObject({
      code: "invalid_output",
      retryable: false,
    });
  });

  it("generate throws invalid_output for JSON failing the schema", async () => {
    const { client } = fakeClient({ generate: response([{ text: '{"answer":"maybe"}' }]) });
    await expect(
      new GeminiProvider({ model: "m", client }).generate(testRequest(), Answer),
    ).rejects.toMatchObject({
      code: "invalid_output",
      retryable: false,
    });
  });

  it.each([
    [429, "rate_limited", true],
    [503, "upstream", true],
    [400, "upstream", false],
  ] as const)("maps ApiError %i to %s (retryable %s)", async (status, code, retryable) => {
    const { client } = fakeClient({ error: new ApiError({ message: "nope", status }) });
    const provider = new GeminiProvider({ model: "m", client });
    await expect(collect(provider.stream(testRequest()))).rejects.toMatchObject({
      code,
      status,
      retryable,
    });
    await expect(provider.generate(testRequest(), Answer)).rejects.toMatchObject({
      code,
      status,
      retryable,
    });
  });

  it("maps a network failure to a retryable upstream error", async () => {
    const { client } = fakeClient({ error: new TypeError("fetch failed") });
    await expect(
      collect(new GeminiProvider({ model: "m", client }).stream(testRequest())),
    ).rejects.toMatchObject({ code: "upstream", status: 503, retryable: true });
  });
});
