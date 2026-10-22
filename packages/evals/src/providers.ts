import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMProvider } from "@frontdesk/core";
import {
  FsRecordingStore,
  MemoryCacheStore,
  MemoryRateLimitStore,
  MemorySpendStore,
  ReplayProvider,
  createLLM,
  withRecorder,
  type CreateLLMDeps,
} from "@frontdesk/llm";
import { OllamaProvider } from "./caller/ollama.js";
import { RECORDINGS_DIR } from "./paths.js";
import type { Mode } from "./report.js";
import { withPatience } from "./wrappers.js";

/** gemma3:4b beat mistral:latest as the caller in M4 Part B trials (spec §15). */
export const DEFAULT_CALLER_MODEL = "gemma3:4b";

/** Per-call Gemini timeout for live/record runs (the server keeps M2's 10 s). */
export const EVAL_TIMEOUT_MS = 30_000;

export interface Manifest {
  agentModel: string;
  callerModel: string;
}

export interface Providers extends Manifest {
  agent: LLMProvider;
  caller: LLMProvider;
}

export interface ProviderDeps {
  recordingsDir?: string;
  fetch?: typeof globalThis.fetch;
  geminiClient?: CreateLLMDeps["geminiClient"];
  sleep?: (ms: number) => Promise<void>;
}

const MANIFEST = "manifest.json";
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readManifest(dir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, MANIFEST), "utf8")) as Manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * The agent and caller for a mode. live: Gemini + Ollama. record: the same, with every call
 * written to the recordings dir. replay: both answered from recordings — no keys, no network.
 */
export async function buildProviders(
  mode: Mode,
  env: Record<string, string | undefined>,
  deps: ProviderDeps = {},
): Promise<Providers> {
  const dir = deps.recordingsDir ?? RECORDINGS_DIR;
  const store = new FsRecordingStore(dir);

  if (mode === "replay") {
    const manifest = await readManifest(dir);
    if (!manifest) throw new Error(`no recordings in ${dir}: run pnpm eval --record`);
    return {
      ...manifest,
      agent: new ReplayProvider(store, manifest.agentModel),
      caller: new ReplayProvider(store, manifest.callerModel),
    };
  }

  const record = mode === "record";
  const gemini = createLLM(
    {
      ...env,
      LLM_PROVIDER: "gemini",
      LLM_RECORD: record ? "1" : "0",
      // Evals don't gate on latency; a slow-but-valid answer beats a timeout in a recording.
      LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS || String(EVAL_TIMEOUT_MS),
    },
    {
      rate: new MemoryRateLimitStore(),
      spend: new MemorySpendStore(),
      cache: new MemoryCacheStore(),
      recordings: store,
      geminiClient: deps.geminiClient,
    },
  );
  const agent = withPatience(gemini, { sleep: deps.sleep ?? realSleep });
  const ollama = new OllamaProvider({
    model: env.EVAL_CALLER_MODEL || DEFAULT_CALLER_MODEL,
    baseUrl: env.OLLAMA_URL || undefined,
    fetch: deps.fetch,
  });
  const caller = record ? withRecorder(ollama, { store }) : ollama;
  const manifest = { agentModel: agent.model, callerModel: caller.model };
  if (record) await writeManifest(dir, manifest);
  return { ...manifest, agent, caller };
}
