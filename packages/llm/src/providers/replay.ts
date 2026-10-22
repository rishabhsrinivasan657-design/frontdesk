import {
  LLMError,
  type LLMChunk,
  type LLMProvider,
  type LLMRequest,
  type Usage,
} from "@frontdesk/core";
import type { ZodType } from "zod";
import { parseOutput } from "../output.js";
import {
  type CallMode,
  type Recording,
  type RecordingStore,
  requestKey,
  templateHash,
} from "../recordings.js";

/** Answers from recordings only; never touches the network (spec §7, CI evals). */
export class ReplayProvider implements LLMProvider {
  constructor(
    private readonly store: RecordingStore,
    readonly model: string,
  ) {}

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    const recording = await this.find("stream", req);
    if (!("chunks" in recording.response)) throw mismatch(recording);
    yield* recording.response.chunks;
  }

  async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
    const recording = await this.find("generate", req, schema);
    if (!("value" in recording.response)) throw mismatch(recording);
    return {
      value: parseOutput(schema, recording.response.value),
      usage: recording.response.usage,
    };
  }

  private async find(mode: CallMode, req: LLMRequest, schema?: ZodType): Promise<Recording> {
    const key = requestKey(mode, this.model, req, schema);
    const hash = templateHash(req);
    const recording = await this.store.get(req.template.id, key);
    // A hit recorded under an older template is stale too, even if the rendered request matches.
    if (recording && recording.templateHash === hash) return recording;
    const hashes = recording
      ? new Set([recording.templateHash])
      : await this.store.hashesFor(req.template.id);
    if (hashes.size > 0 && !hashes.has(hash)) {
      throw new LLMError(
        "stale_recording",
        `Stale recording: re-record: template ${req.template.id} or its tool schemas changed`,
      );
    }
    throw new LLMError("replay_miss", `No recording for template ${req.template.id}, key ${key}`);
  }
}

function mismatch(recording: Recording): LLMError {
  return new LLMError(
    "replay_miss",
    `Recording ${recording.key} has the wrong mode (${recording.mode})`,
  );
}
