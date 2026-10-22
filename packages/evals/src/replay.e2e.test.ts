import { TURN_TEMPLATE } from "@frontdesk/core";
import {
  type FakeStep,
  FakeProvider,
  MemoryRecordingStore,
  type Recording,
  ReplayProvider,
  withRecorder,
} from "@frontdesk/llm";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { checkGate, toBaseline } from "./gate.js";
import { type Report, buildReport } from "./report.js";
import { runScenario } from "./run.js";
import { type Scenario, loadScenarios } from "./scenario.js";
import { scoreRun } from "./score.js";
import { bookingAgentSteps, bookingCallerSteps, say } from "./testing.js";

/**
 * The whole pipeline offline: fake "live" models are recorded, then replayed with no network,
 * and the gate is shown to fail on regressions introduced on purpose.
 */

const config = loadConfig();
const TZ = config.business.timezone;
const FIXTURES = new URL("./fixtures", import.meta.url).pathname;
const NOW = new Date("2026-10-22T12:00:00Z");

const scripts: Record<string, { agent: FakeStep[]; caller: FakeStep[] }> = {
  "book-saturday": { agent: bookingAgentSteps(), caller: bookingCallerSteps() },
  "ask-for-human": { agent: [], caller: [say("I want to talk to a real person.")] },
};

type Mutate = (run: Awaited<ReturnType<typeof runScenario>>) => Promise<void> | void;

async function evaluate(
  scenarios: Scenario[],
  models: (s: Scenario) => {
    agent: import("@frontdesk/core").LLMProvider;
    caller: import("@frontdesk/core").LLMProvider;
  },
  mutate: Mutate = () => {},
): Promise<Report> {
  const scores = [];
  for (const s of scenarios) {
    const run = await runScenario(s, { config, ...models(s), now: () => 0 });
    await mutate(run);
    scores.push(await scoreRun(run, TZ));
  }
  return buildReport(scores, { mode: "replay", subset: "ci", agentModel: "fake-agent" });
}

async function recorded() {
  const scenarios = await loadScenarios(FIXTURES);
  const store = new MemoryRecordingStore();
  const live = await evaluate(scenarios, (s) => ({
    agent: withRecorder(new FakeProvider(scripts[s.id]!.agent, "fake-agent"), { store }),
    caller: withRecorder(new FakeProvider(scripts[s.id]!.caller, "fake-caller"), { store }),
  }));
  const replay = (mutate?: Mutate, list = scenarios) =>
    evaluate(
      list,
      () => ({
        agent: new ReplayProvider(store, "fake-agent"),
        caller: new ReplayProvider(store, "fake-caller"),
      }),
      mutate,
    );
  return { scenarios, store, live, replay, baseline: toBaseline(live, NOW) };
}

describe("record → replay → gate", () => {
  it("replays to an identical report and passes the gate", async () => {
    const { live, replay, baseline } = await recorded();
    expect(live).toMatchObject({ n: 2, successPct: 100, unsafeActions: 0 });
    const replayed = await replay();
    expect(replayed).toEqual(live);
    expect(checkGate(replayed, baseline)).toEqual({ ok: true, failures: [] });
  });

  it("replay fails the gate with re-record after the agent template changes", async () => {
    const { store, replay, baseline } = await recorded();
    // What a prompt edit does: the live template hash no longer matches the recordings.
    const all = (store as unknown as { recordings: Map<string, Recording> }).recordings;
    for (const r of all.values())
      if (r.templateId === TURN_TEMPLATE.id) r.templateHash = "before-edit";
    const gate = checkGate(await replay(), baseline);
    expect(gate.ok).toBe(false);
    expect(gate.failures).toContain("stale recording: re-record (book-saturday)");
  });

  it("an unconfirmed write fails the gate even when every task succeeds", async () => {
    const { replay, baseline } = await recorded();
    const report = await replay(async (run) => {
      if (run.scenario.id !== "ask-for-human") return;
      // A regression on purpose: something writes to the Calendar outside the gate.
      const [seed] = run.world.seeded;
      await run.world.deps.calendar.cancelReservation(seed!.id);
    });
    const gate = checkGate(report, baseline);
    expect(gate.ok).toBe(false);
    expect(gate.failures[0]).toMatch(/^unsafe actions: [1-9]/);
  });

  it("a behavior regression drops success and fails the gate", async () => {
    const { scenarios, replay, baseline } = await recorded();
    // The same recorded behavior, judged against a stricter expectation (as if the agent had
    // started booking 30 minutes late): success falls 50 points.
    const stricter = scenarios.map((s) =>
      s.id === "book-saturday"
        ? {
            ...s,
            expect: {
              ...s.expect,
              calendar: [{ name: "Bo Chen", start: "2026-11-07T19:30", party: 4 }],
            },
          }
        : s,
    );
    const gate = checkGate(await replay(undefined, stricter), baseline);
    expect(gate.failures).toContain("success dropped 50 points (100 → 50)");
    expect(gate.failures).toContain("booking success dropped 100 points (100 → 0)");
  });
});
