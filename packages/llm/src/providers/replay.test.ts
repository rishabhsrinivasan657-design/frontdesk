import type { LLMChunk } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryRecordingStore, type Recording, requestKey, templateHash } from "../recordings.js";
import { collect, testRequest } from "../test-request.js";
import { ReplayProvider } from "./replay.js";

const chunks: LLMChunk[] = [
  { type: "text", text: "We have street parking." },
  { type: "usage", usage: { inputTokens: 4, outputTokens: 5 } },
];
const Answer = z.object({ answer: z.enum(["yes", "no"]) });

function recording(
  mode: "stream" | "generate",
  response: Recording["response"],
  req = testRequest(),
): Recording {
  return {
    version: 1,
    key: requestKey(mode, "m", req, mode === "generate" ? Answer : undefined),
    templateId: req.template.id,
    templateHash: templateHash(req),
    model: "m",
    mode,
    request: req,
    response,
    recordedAt: "2026-10-22T00:00:00.000Z",
  };
}

describe("ReplayProvider", () => {
  it("streams a recorded answer", async () => {
    const store = new MemoryRecordingStore();
    await store.put(recording("stream", { chunks }));
    expect(await collect(new ReplayProvider(store, "m").stream(testRequest()))).toEqual(chunks);
  });

  it("generate parses the recorded value", async () => {
    const store = new MemoryRecordingStore();
    const usage = { inputTokens: 2, outputTokens: 1 };
    await store.put(recording("generate", { value: { answer: "no" }, usage }));
    expect(await new ReplayProvider(store, "m").generate(testRequest(), Answer)).toEqual({
      value: { answer: "no" },
      usage,
    });
  });

  it("replay miss throws replay_miss", async () => {
    const replay = new ReplayProvider(new MemoryRecordingStore(), "m");
    await expect(collect(replay.stream(testRequest()))).rejects.toMatchObject({
      code: "replay_miss",
    });
    await expect(replay.generate(testRequest(), Answer)).rejects.toMatchObject({
      code: "replay_miss",
    });
  });

  it("changed template throws stale_recording", async () => {
    const store = new MemoryRecordingStore();
    await store.put(recording("stream", { chunks }));
    const changed = testRequest({ template: { id: "test", text: "New prompt." } });
    const replay = new ReplayProvider(store, "m");
    await expect(collect(replay.stream(changed))).rejects.toMatchObject({
      code: "stale_recording",
    });
    await expect(collect(replay.stream(changed))).rejects.toThrow(/re-record/);
  });

  it("changed template with a changed rendered prompt throws stale_recording", async () => {
    const store = new MemoryRecordingStore();
    await store.put(recording("stream", { chunks }));
    const changed = testRequest({
      template: { id: "test", text: "New prompt." },
      system: "New prompt.",
    });
    await expect(collect(new ReplayProvider(store, "m").stream(changed))).rejects.toMatchObject({
      code: "stale_recording",
    });
  });
});
