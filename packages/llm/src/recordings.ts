import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMChunk, LLMRequest, Usage } from "@frontdesk/core";
import { type ZodType, z } from "zod";
import { canonicalJson, sha256 } from "./hash.js";

export type CallMode = "stream" | "generate";

/** Identity of one LLM call: everything that can change the answer (shared by cache and recordings). */
export function requestKey(
  mode: CallMode,
  model: string,
  req: LLMRequest,
  schema?: ZodType,
): string {
  return sha256(
    canonicalJson({
      mode,
      model,
      purpose: req.purpose,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      schema: schema ? z.toJSONSchema(schema) : undefined,
    }),
  );
}

/** Hash of the prompt template and tool schemas; a change means recordings are stale (spec §7, §9). */
export function templateHash(req: LLMRequest): string {
  return sha256(req.template.text + canonicalJson(req.tools ?? []));
}

export interface Recording {
  version: 1;
  key: string;
  templateId: string;
  templateHash: string;
  model: string;
  mode: CallMode;
  request: LLMRequest;
  response: { chunks: LLMChunk[] } | { value: unknown; usage: Usage };
  recordedAt: string;
}

export interface RecordingStore {
  get(templateId: string, key: string): Promise<Recording | undefined>;
  put(recording: Recording): Promise<void>;
  /** Every templateHash recorded for this template id. */
  hashesFor(templateId: string): Promise<Set<string>>;
}

export class MemoryRecordingStore implements RecordingStore {
  private readonly recordings = new Map<string, Recording>();

  get(templateId: string, key: string): Promise<Recording | undefined> {
    return Promise.resolve(this.recordings.get(`${templateId}/${key}`));
  }

  put(recording: Recording): Promise<void> {
    this.recordings.set(`${recording.templateId}/${recording.key}`, recording);
    return Promise.resolve();
  }

  hashesFor(templateId: string): Promise<Set<string>> {
    const hashes = [...this.recordings.values()]
      .filter((r) => r.templateId === templateId)
      .map((r) => r.templateHash);
    return Promise.resolve(new Set(hashes));
  }
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/** One JSON file per call: `<dir>/<templateId>/<key>.json`. */
export class FsRecordingStore implements RecordingStore {
  constructor(private readonly dir: string) {}

  async get(templateId: string, key: string): Promise<Recording | undefined> {
    try {
      return JSON.parse(await readFile(this.file(templateId, key), "utf8")) as Recording;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async put(recording: Recording): Promise<void> {
    await mkdir(this.templateDir(recording.templateId), { recursive: true });
    const file = this.file(recording.templateId, recording.key);
    await writeFile(file, `${JSON.stringify(recording, null, 2)}\n`);
  }

  async hashesFor(templateId: string): Promise<Set<string>> {
    let names: string[];
    try {
      names = await readdir(this.templateDir(templateId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw error;
    }
    const recordings = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.get(templateId, name.slice(0, -".json".length))),
    );
    return new Set(recordings.flatMap((r) => (r ? [r.templateHash] : [])));
  }

  private templateDir(templateId: string): string {
    if (!SAFE_ID.test(templateId) || templateId.startsWith(".")) {
      throw new Error(`Invalid template id for a recording path: ${JSON.stringify(templateId)}`);
    }
    return join(this.dir, templateId);
  }

  private file(templateId: string, key: string): string {
    return join(this.templateDir(templateId), `${key}.json`);
  }
}
