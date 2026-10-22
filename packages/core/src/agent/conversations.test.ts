import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import type { LLMChunk } from "../llm/types.js";
import { ANA, agentFixture } from "../testing/agent-fixtures.js";
import { runTurn } from "./loop.js";

/** Spec §14 M3: scripted fake-LLM conversations book, reschedule, cancel and hand off. */

let seq = 0;
const text = (t: string): LLMChunk => ({ type: "text", text: t });
const call = (name: string, args: Record<string, unknown>): LLMChunk => ({
  type: "tool_call",
  call: { id: `c${++seq}`, name, args },
});

/** A conversation: each caller line with the model's responses for that turn. */
async function converse(
  fx: ReturnType<typeof agentFixture>,
  script: [caller: string, ...responses: LLMChunk[][]][],
) {
  const results = [];
  for (const [caller, ...responses] of script) {
    let i = 0;
    fx.deps.llm.onStream(() => responses[i++] ?? [text("Okay.")]);
    results.push(await runTurn(fx.deps, { sessionId: "s1", text: caller }));
  }
  return results;
}

const types = (r: { messages: { type: string }[] }) => r.messages.map((m) => m.type);
const stagesOf = (fx: ReturnType<typeof agentFixture>) =>
  fx.deps.audit.entries().map((e) => `${e.kind}:${e.stage}`);
const calendarState = async (fx: ReturnType<typeof agentFixture>) =>
  (
    await fx.deps.calendar.listReservations({
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-12-01T00:00:00Z"),
    })
  ).map((b) => ({ name: b.name, start: b.start.toISOString(), party: b.partySize }));

describe("scripted conversations", () => {
  it("books a table", async () => {
    const fx = agentFixture(testConfig(), []);
    const [ask, readBack, done] = await converse(fx, [
      [
        "Hi, a table for 4 this Saturday at 7?",
        [call("check_availability", { date: "2026-11-07", time: "19:00", partySize: 4 })],
        [text("Saturday at 7:00 PM is open. What name and email should I use?")],
      ],
      [
        "Bo Chen, bo@example.com",
        [
          call("book", {
            slotId: "2026-11-07T19:00@t4-1#4",
            name: "Bo Chen",
            contact: "bo@example.com",
            partySize: 4,
          }),
        ],
      ],
      ["yes"],
    ]);
    expect(types(ask!)).toEqual(["agent_sentence", "agent_sentence", "turn_metrics"]);
    expect(types(readBack!)).toEqual([
      "pending_action",
      "agent_sentence",
      "agent_sentence",
      "turn_metrics",
    ]);
    expect(types(done!)).toEqual([
      "action_result",
      "agent_sentence",
      "agent_sentence",
      "turn_metrics",
    ]);
    expect(await calendarState(fx)).toEqual([
      { name: "Bo Chen", start: "2026-11-08T00:00:00.000Z", party: 4 },
    ]);
    expect(stagesOf(fx)).toEqual(["book:proposed", "book:confirmed", "book:executed"]);
    expect(fx.deps.mailer.sent).toHaveLength(1);
  });

  it("reschedules a reservation", async () => {
    const fx = agentFixture(testConfig());
    const results = await converse(fx, [
      [
        "I need to move my Friday booking, Ana Ruiz, ana@example.com",
        [call("find_reservation", { name: "Ana Ruiz", contact: "ana@example.com" })],
        [text("I found your reservation. When would you like instead?")],
      ],
      [
        "Saturday around 7",
        [call("check_availability", { date: "2026-11-07", time: "19:00", partySize: 4 })],
        [call("reschedule", { reservationId: ANA.id, slotId: "2026-11-07T19:00@t4-1#4" })],
      ],
      ["yep"],
    ]);
    expect(types(results[1]!)[0]).toBe("pending_action");
    expect(results[2]!.reply).toContain("now on Saturday, November 7 at 7:00 PM");
    expect(await calendarState(fx)).toEqual([
      { name: "Ana Ruiz", start: "2026-11-08T00:00:00.000Z", party: 4 },
    ]);
    expect(stagesOf(fx)).toEqual([
      "reschedule:proposed",
      "reschedule:confirmed",
      "reschedule:executed",
    ]);
  });

  it("cancels a reservation", async () => {
    const fx = agentFixture(testConfig());
    const results = await converse(fx, [
      [
        "Cancel my reservation please. Ana Ruiz, ana@example.com",
        [call("find_reservation", { name: "Ana Ruiz", contact: "ana@example.com" })],
        [call("cancel", { reservationId: ANA.id })],
      ],
      ["yes please"],
    ]);
    expect(results[0]!.reply).toContain("Shall I cancel it?");
    expect(results[1]!.reply).toContain("is cancelled");
    expect(await calendarState(fx)).toEqual([]);
    expect(stagesOf(fx)).toEqual(["cancel:proposed", "cancel:confirmed", "cancel:executed"]);
  });

  it("hands off a party too large for the agent", async () => {
    const fx = agentFixture(testConfig());
    const [result] = await converse(fx, [
      [
        "Table for 12 on Saturday?",
        [call("check_availability", { date: "2026-11-07", time: "19:00", partySize: 12 })],
      ],
    ]);
    expect(result!.handoff).toBe("party_too_large");
    expect(types(result!)).toEqual(["handoff", "agent_sentence", "agent_sentence", "turn_metrics"]);
    expect(fx.deps.handoffs.tickets.map((t) => t.reason)).toEqual(["party_too_large"]);
    expect(fx.deps.calendar.writes).toEqual([]);
  });

  it("drops a declined booking", async () => {
    const fx = agentFixture(testConfig(), []);
    const results = await converse(fx, [
      [
        "Saturday at 7 for 4, Bo Chen, bo@example.com",
        [call("check_availability", { date: "2026-11-07", time: "19:00", partySize: 4 })],
        [
          call("book", {
            slotId: "2026-11-07T19:00@t4-1#4",
            name: "Bo Chen",
            contact: "bo@example.com",
            partySize: 4,
          }),
        ],
      ],
      ["no", [text("No problem. Anything else I can help with?")]],
    ]);
    expect(types(results[1]!)[0]).toBe("action_result");
    expect(results[1]!.messages[0]).toMatchObject({ status: "voided", reason: "deny" });
    expect(await calendarState(fx)).toEqual([]);
    expect(stagesOf(fx)).toEqual(["book:proposed", "book:voided"]);
  });
});
