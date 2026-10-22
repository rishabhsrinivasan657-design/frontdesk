import { LLMError, type LLMChunk } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeProvider } from "../providers/fake.js";
import { ReplayProvider } from "../providers/replay.js";
import { MemoryRecordingStore, requestKey, templateHash } from "../recordings.js";
import { collect, testRequest } from "../test-request.js";
import { withRecorder } from "./recorder.js";

const chunks: LLMChunk[] = [
  { type: "text", text: "Party of four at 7pm?" },
  { type: "usage", usage: { inputTokens: 9, outputTokens: 6 } },
];
const Answer = z.object({ answer: z.enum(["confirm", "deny"]) });
const now = () => Date.parse("2026-10-22T18:00:00Z");

describe("withRecorder", () => {
  it("records a completed stream with key, templateId and templateHash", async () => {
    const store = new MemoryRecordingStore();
    const req = testRequest();
    const llm = withRecorder(new FakeProvider([{ stream: chunks }]), { store, now });
    expect(await collect(llm.stream(req))).toEqual(chunks);

    const key = requestKey("stream", "fake", req);
    expect(await store.get("test", key)).toEqual({
      version: 1,
      key,
      templateId: "test",
      templateHash: templateHash(req),
      model: "fake",
      mode: "stream",
      request: req,
      response: { chunks },
      recordedAt: "2026-10-22T18:00:00.000Z",
    });
  });

  it("records generate value and usage", async () => {
    const store = new MemoryRecordingStore();
    const req = testRequest({ purpose: "confirmation" });
    const usage = { inputTokens: 3, outputTokens: 1 };
    const llm = withRecorder(new FakeProvider([{ generate: { answer: "confirm" }, usage }]), {
      store,
      now,
    });
    await llm.generate(req, Answer);
    const recording = await store.get("test", requestKey("generate", "fake", req, Answer));
    expect(recording?.response).toEqual({ value: { answer: "confirm" }, usage });
  });

  it("does not record a failed call", async () => {
    const store = new MemoryRecordingStore();
    const error = new LLMError("upstream", "down", { status: 503 });
    const llm = withRecorder(new FakeProvider([{ error, afterChunks: [chunks[0]!] }, { error }]), {
      store,
      now,
    });
    await expect(collect(llm.stream(testRequest()))).rejects.toBe(error);
    await expect(llm.generate(testRequest(), Answer)).rejects.toBe(error);
    expect(await store.hashesFor("test")).toEqual(new Set());
  });

  it("round-trip: record via withRecorder(fake), then ReplayProvider reproduces it", async () => {
    const store = new MemoryRecordingStore();
    const usage = { inputTokens: 3, outputTokens: 1 };
    const recorder = withRecorder(
      new FakeProvider([{ stream: chunks }, { generate: { answer: "deny" }, usage }]),
      {
        store,
        now,
      },
    );
    await collect(recorder.stream(testRequest()));
    await recorder.generate(testRequest(), Answer);

    const replay = new ReplayProvider(store, "fake");
    expect(await collect(replay.stream(testRequest()))).toEqual(chunks);
    expect(await replay.generate(testRequest(), Answer)).toEqual({
      value: { answer: "deny" },
      usage,
    });
  });
});
