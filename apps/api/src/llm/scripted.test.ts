import { runTurn } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { BOOK, DETAILS, memoryDeps } from "../test-deps.js";

const types = (r: { messages: { type: string }[] }) => r.messages.map((m) => m.type);

describe("ScriptedLLM", () => {
  it("a booking script reaches a pending action, then books on yes", async () => {
    const deps = memoryDeps();
    const ask = await runTurn(deps, { sessionId: "s1", text: BOOK });
    expect(ask.reply).toBe("That time is open. What name and email should I use?");
    const readBack = await runTurn(deps, { sessionId: "s1", text: DETAILS });
    expect(types(readBack)).toContain("pending_action");
    const done = await runTurn(deps, { sessionId: "s1", text: "Yes, please" });
    expect(done.messages).toContainEqual(
      expect.objectContaining({ type: "action_result", status: "executed" }),
    );
    const booked = await deps.calendar.listReservations({
      from: new Date("2026-11-07T00:00:00Z"),
      to: new Date("2026-11-09T00:00:00Z"),
    });
    expect(booked.map((b) => [b.name, b.partySize, b.start.toISOString()])).toEqual([
      ["Bo Chen", 4, "2026-11-08T00:00:00.000Z"],
    ]);
  });

  it("a change after the read-back voids it, then re-books another time", async () => {
    const deps = memoryDeps();
    await runTurn(deps, { sessionId: "s1", text: BOOK });
    await runTurn(deps, { sessionId: "s1", text: DETAILS });
    const change = await runTurn(deps, { sessionId: "s1", text: "I'd like to change something" });
    expect(change.messages).toContainEqual(
      expect.objectContaining({ type: "action_result", status: "voided", reason: "change" }),
    );
    expect(await deps.sessions.getPending("s1")).toBeUndefined();
    const moved = await runTurn(deps, { sessionId: "s1", text: "Make it 20:30" });
    expect(moved.reply).toBe("That time is open. What name and email should I use?");
    const readBack = await runTurn(deps, { sessionId: "s1", text: DETAILS });
    const pending = readBack.messages.find((m) => m.type === "pending_action");
    expect(pending && "summary" in pending ? pending.summary : "").toContain("8:30");
  });

  it("says a full time is full", async () => {
    const deps = memoryDeps();
    const r = await runTurn(deps, {
      sessionId: "s1",
      text: "A table for 4 on 2026-11-07 at 23:30",
    });
    expect(r.reply).toBe("That time is full. Could you try another time?");
  });

  it("replies pass the grounding check", async () => {
    const deps = memoryDeps();
    for (const text of [BOOK, DETAILS, "Hello"]) {
      const r = await runTurn(deps, { sessionId: "s1", text });
      expect(r.flags).not.toContain("grounding_regenerated");
      expect(r.flags).not.toContain("meta_missing");
    }
  });

  it("answers anything else with a generic question", async () => {
    const r = await runTurn(memoryDeps(), { sessionId: "s1", text: "What's up?" });
    expect(r.reply).toBe("How can I help with a reservation?");
  });
});
