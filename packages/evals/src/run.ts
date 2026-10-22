import {
  type BusinessConfig,
  type HandoffReason,
  type LLMError,
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

/**
 * Plays one scenario: the caller speaks first after the greeting, then caller and agent
 * alternate until the caller is done (after the agent answers their last message), the agent
 * hands off, or `maxTurns` caller turns pass.
 */
export async function runScenario(scenario: Scenario, options: RunOptions): Promise<ScenarioRun> {
  const { config, now = () => performance.now() } = options;
  const tapped: LLMError[] = [];
  const caller = withErrorTap(options.caller, tapped);
  const world = seedWorld(scenario, config, withErrorTap(options.agent, tapped));
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
      // The caller's last words ("yes, book it, bye") still reach the agent before hanging up.
      if (value.done) {
        run.endedBy = "caller_done";
        break;
      }
    }
  } catch (error) {
    run.endedBy = "error";
    run.error = error instanceof Error ? error.message : String(error);
  }

  const errors = tapped.map((e) => e.code);
  if (tapped.length > 0 && !run.error) {
    run.error = `LLM errors: ${[...new Set(tapped.map((e) => `${e.code} (${e.message})`))].join("; ")}`;
  }
  run.status = errors.includes("stale_recording")
    ? "stale"
    : errors.includes("replay_miss")
      ? "missing"
      : errors.includes("rate_limited")
        ? "quota"
        : // Any other LLM failure the loop swallowed (outage, bad output) left an unrecorded
          // call or a fallback path: the run says nothing reliable about the agent.
          run.endedBy === "error" || errors.length > 0
          ? "error"
          : "ok";
  return run;
}
