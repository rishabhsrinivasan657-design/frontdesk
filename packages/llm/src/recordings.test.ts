import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolSpec } from "@frontdesk/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { FsRecordingStore, type Recording, requestKey, templateHash } from "./recordings.js";
import { testRequest } from "./test-request.js";

const tool: ToolSpec = {
  name: "lookup_faq",
  description: "FAQ",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  effect: "read",
};

describe("requestKey", () => {
  const withResult = (result: unknown) =>
    testRequest({
      messages: [
        { role: "user", text: "parking?" },
        { role: "tool", callId: "c1", name: "lookup_faq", result },
      ],
    });

  it("changes when a tool result changes", () => {
    expect(requestKey("stream", "m", withResult("a"))).not.toBe(
      requestKey("stream", "m", withResult("b")),
    );
  });

  it("changes when the schema changes", () => {
    const req = testRequest();
    expect(requestKey("generate", "m", req, z.object({ a: z.string() }))).not.toBe(
      requestKey("generate", "m", req, z.object({ b: z.string() })),
    );
  });

  it("changes with mode and model", () => {
    const req = testRequest();
    const keys = new Set([
      requestKey("stream", "m", req),
      requestKey("generate", "m", req),
      requestKey("stream", "other", req),
    ]);
    expect(keys.size).toBe(3);
  });

  it("does not change when key order changes", () => {
    const a = testRequest({
      messages: [{ role: "tool", callId: "c", name: "n", result: { x: 1, y: 2 } }],
    });
    const b = testRequest({
      messages: [{ role: "tool", callId: "c", name: "n", result: { y: 2, x: 1 } }],
    });
    expect(requestKey("stream", "m", a)).toBe(requestKey("stream", "m", b));
  });
});

describe("templateHash", () => {
  it("changes when a tool's parameters change", () => {
    const changed = {
      ...tool,
      parameters: { type: "object", properties: { q: { type: "string" } } },
    };
    expect(templateHash(testRequest({ tools: [tool] }))).not.toBe(
      templateHash(testRequest({ tools: [changed] })),
    );
  });

  it("changes when the template text changes", () => {
    expect(templateHash(testRequest())).not.toBe(
      templateHash(testRequest({ template: { id: "test", text: "Different." } })),
    );
  });
});

describe("FsRecordingStore", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips in a temp dir", async () => {
    dir = await mkdtemp(join(tmpdir(), "fd-rec-"));
    const store = new FsRecordingStore(join(dir, "nested"));
    const req = testRequest();
    const recording: Recording = {
      version: 1,
      key: requestKey("stream", "m", req),
      templateId: "test",
      templateHash: templateHash(req),
      model: "m",
      mode: "stream",
      request: req,
      response: { chunks: [{ type: "text", text: "hi" }] },
      recordedAt: "2026-10-22T00:00:00.000Z",
    };
    await store.put(recording);

    expect(await store.get("test", recording.key)).toEqual(recording);
    expect(await store.get("test", "missing")).toBeUndefined();
    expect(await store.hashesFor("test")).toEqual(new Set([recording.templateHash]));
    expect(await store.hashesFor("unknown")).toEqual(new Set());
    const file = await readFile(join(dir, "nested", "test", `${recording.key}.json`), "utf8");
    expect(file.endsWith("}\n")).toBe(true);
  });

  it("rejects a template id that would escape the directory", async () => {
    dir = await mkdtemp(join(tmpdir(), "fd-rec-"));
    await expect(new FsRecordingStore(dir).get("../etc", "k")).rejects.toThrow(/template id/);
  });
});
