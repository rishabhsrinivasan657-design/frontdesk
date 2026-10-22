import { LLMError, TURN_TEMPLATE } from "@frontdesk/core";
import { FakeProvider, MemoryRecordingStore, ReplayProvider } from "@frontdesk/llm";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { runScenario } from "./run.js";
import { bookingAgentSteps, bookingCallerSteps, say, scenario, text } from "./testing.js";

const config = loadConfig();

describe("runScenario", () => {
  it("books through the real gate and ends when the caller is done", async () => {
    let t = 0;
    const run = await runScenario(scenario(), {
      config,
      agent: new FakeProvider(bookingAgentSteps()),
      caller: new FakeProvider(bookingCallerSteps()),
      now: () => (t += 100),
    });
    expect(run.status).toBe("ok");
    expect(run.endedBy).toBe("caller_done");
    expect(run.turns).toBe(4);
    expect(run.latencyMs).toEqual([100, 100, 100, 100]);
    expect(run.world.deps.calendar.writes.map((w) => w.op)).toEqual(["create"]);
    expect(run.tokensIn).toBeGreaterThan(0);
    expect(run.transcript[0]).toEqual({ role: "agent", text: config.agent.greeting });
    expect(run.transcript.filter((l) => l.role === "caller")).toHaveLength(4);
  });

  it("sends the caller's last message before ending", async () => {
    // Small models often say "yes" and hang up in the same breath.
    const run = await runScenario(scenario(), {
      config,
      agent: new FakeProvider(bookingAgentSteps()),
      caller: new FakeProvider([
        say("Hi, a table for 4 this Saturday at 7pm?"),
        say("Bo Chen, bo@example.com"),
        say("Yes", true),
      ]),
    });
    expect(run.endedBy).toBe("caller_done");
    expect(run.turns).toBe(3);
    expect(run.world.deps.calendar.writes.map((w) => w.op)).toEqual(["create"]);
  });

  it("doesn't send a bare 'done' as the caller's words", async () => {
    const run = await runScenario(scenario(), {
      config,
      agent: new FakeProvider([{ stream: [text("Would you like a human to call you?")] }]),
      caller: new FakeProvider([say("When do you open Sunday?"), say(" Done. ", true)]),
    });
    expect(run.endedBy).toBe("caller_done");
    expect(run.turns).toBe(1);
    expect(run.transcript.at(-1)).toEqual({
      role: "agent",
      text: "Would you like a human to call you?",
    });
  });

  it("ends on handoff", async () => {
    const run = await runScenario(scenario({ expect: { outcome: "handoff" } }), {
      config,
      agent: new FakeProvider([{ stream: [text("One moment.")] }]),
      caller: new FakeProvider([say("Can I talk to a real person please?")]),
    });
    expect(run.endedBy).toBe("handoff");
    expect(run.handoff).toBe("human_requested");
    expect(run.status).toBe("ok");
  });

  it("stops at maxTurns", async () => {
    const run = await runScenario(scenario({ expect: { maxTurns: 2 } }), {
      config,
      agent: new FakeProvider([{ stream: [text("Okay.")] }, { stream: [text("Okay.")] }]),
      caller: new FakeProvider([say("Hmm."), say("Let me think.")]),
    });
    expect(run.endedBy).toBe("max_turns");
    expect(run.turns).toBe(2);
  });

  it("marks a replay miss as missing, not a handoff", async () => {
    const run = await runScenario(scenario(), {
      config,
      agent: new ReplayProvider(new MemoryRecordingStore(), "m"),
      caller: new FakeProvider([say("Hi, a table for 4?")]),
    });
    expect(run.status).toBe("missing");
  });

  it("marks a hash mismatch as stale", async () => {
    const store = new MemoryRecordingStore();
    await store.put({
      version: 1,
      key: "old",
      templateId: TURN_TEMPLATE.id,
      templateHash: "older-template",
      model: "m",
      mode: "stream",
      request: {} as never,
      response: { chunks: [] },
      recordedAt: "2026-10-01T00:00:00Z",
    });
    const run = await runScenario(scenario(), {
      config,
      agent: new ReplayProvider(store, "m"),
      caller: new FakeProvider([say("Hi, a table for 4?")]),
    });
    expect(run.status).toBe("stale");
  });

  it("records a caller failure as error and keeps going", async () => {
    const run = await runScenario(scenario(), {
      config,
      agent: new FakeProvider([]),
      caller: new FakeProvider([{ error: new LLMError("invalid_output", "not JSON") }]),
    });
    expect(run.status).toBe("error");
    expect(run.endedBy).toBe("error");
    expect(run.error).toMatch(/not JSON/);
  });

  it("marks an agent upstream outage as error, not a handoff score", async () => {
    const run = await runScenario(scenario(), {
      config,
      agent: new FakeProvider([{ error: new LLMError("upstream", "503", { status: 503 }) }]),
      caller: new FakeProvider([say("Hi, a table for 4?")]),
    });
    expect(run.status).toBe("error");
  });

  it("marks a run with a swallowed classifier failure as error", async () => {
    // The loop treats a failed confirmation classification as "unrelated" and carries on, but
    // nothing was recorded for that call, so the run could never replay.
    const run = await runScenario(scenario({ expect: { maxTurns: 1 } }), {
      config,
      agent: new FakeProvider([{ error: new LLMError("invalid_output", "not JSON") }]),
      caller: new FakeProvider([say("Hi, a table for 4?")]),
    });
    expect(run.status).toBe("error");
    expect(run.error).toMatch(/invalid_output/);
  });
});
