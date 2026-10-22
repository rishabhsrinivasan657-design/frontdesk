import {
  type BusinessConfig,
  type HandoffReason,
  type LLMErrorCode,
  type LLMProvider,
  greeting,
  runTurn,
} from "@frontdesk/core";
import { CallerTurnSchema, type TranscriptLine, callerRequest } from "./caller/prompt.js";
import type { Scenario } from "./scenario.js";
import { type World, seedWorld } from "./seed.js";
import { withErrorTap } from "./wrappers.js";

export type RunStatus = "ok" | "missing" | "stale" | "quota" | "error";
export const RUN_STATUSES: readonly RunStatus[] = ["ok", "missing", "stale", "quota", "error"];

export interface ScenarioRun {
  scenario: Scenario;
  status: RunStatus;
  error?: string;
  endedBy: "caller_done" | "handoff" | "max_turns" | "error";
  transcript: TranscriptLine[];
  /** Caller turns the agent answered. */
  turns: number;
  /** Wall-clock time of each agent turn. */
  latencyMs: number[];
  tokensIn: number;
  tokensOut: number;
  world: World;
  handoff?: HandoffReason;
}

export interface RunOptions {
  config: BusinessConfig;
  agent: LLMProvider;
  caller: LLMProvider;
  now?: () => number;
}

/** LLM failures that mean the run says nothing about the agent (outage, quota, bad config). */
const BROKEN: readonly LLMErrorCode[] = ["upstream", "spend_cap", "config"];

/**
 * Plays one scenario: the caller speaks first after the greeting, then caller and agent
 * alternate until the caller is done, the agent hands off, or `maxTurns` caller turns pass.
 */
export async function runScenario(scenario: Scenario, options: RunOptions): Promise<ScenarioRun> {
  const { config, now = () => performance.now() } = options;
  const errors: LLMErrorCode[] = [];
  const caller = withErrorTap(options.caller, errors);
  const world = seedWorld(scenario, config, withErrorTap(options.agent, errors));
  const run: ScenarioRun = {
    scenario,
    status: "ok",
    endedBy: "max_turns",
    transcript: [{ role: "agent", text: greeting(config) }],
    turns: 0,
    latencyMs: [],
    tokensIn: 0,
    tokensOut: 0,
    world,
  };

  try {
    while (run.turns < scenario.expect.maxTurns) {
      const { value } = await caller.generate(
        callerRequest(scenario, run.transcript),
        CallerTurnSchema,
      );
      if (value.done && run.turns > 0) {
        run.endedBy = "caller_done";
        break;
      }
      run.transcript.push({ role: "caller", text: value.say });
      run.turns += 1;

      const started = now();
      const result = await runTurn(world.deps, { sessionId: world.sessionId, text: value.say });
      run.latencyMs.push(now() - started);
      run.transcript.push({ role: "agent", text: result.reply });
      for (const m of result.messages) {
        if (m.type === "turn_metrics") {
          run.tokensIn += m.tokensIn;
          run.tokensOut += m.tokensOut;
        }
      }
      if (result.handoff) {
        run.handoff = result.handoff;
        run.endedBy = "handoff";
        break;
      }
    }
  } catch (error) {
    run.endedBy = "error";
    run.error = error instanceof Error ? error.message : String(error);
  }

  run.status = errors.includes("stale_recording")
    ? "stale"
    : errors.includes("replay_miss")
      ? "missing"
      : errors.includes("rate_limited")
        ? "quota"
        : run.endedBy === "error" || errors.some((c) => BROKEN.includes(c))
          ? "error"
          : "ok";
  return run;
}
