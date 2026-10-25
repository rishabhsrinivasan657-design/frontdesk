import { describe, expect, it } from "vitest";
import { applyLiveEvent, type LiveCard } from "./live-state";

const AT = "2026-11-04T19:00:00.000Z";
const open = (sessionId: string) => ({ type: "session_open" as const, sessionId, at: AT });

describe("applyLiveEvent", () => {
  it("adds a card when a session opens, newest first, once", () => {
    let s: LiveCard[] = [];
    s = applyLiveEvent(s, open("s1"));
    s = applyLiveEvent(s, { ...open("s2"), at: "2026-11-04T19:01:00.000Z" });
    s = applyLiveEvent(s, open("s1"));
    expect(s.map((c) => c.sessionId)).toEqual(["s2", "s1"]);
  });

  it("turn updates the last exchange", () => {
    const s = applyLiveEvent(applyLiveEvent([], open("s1")), {
      type: "turn",
      sessionId: "s1",
      turnId: "t1",
      callerText: "Table for 4?",
      agentText: "Saturday at 7 is open.",
      firstOutputMs: 640,
      flags: [],
      at: AT,
    });
    expect(s[0]).toMatchObject({
      turnCount: 1,
      lastCallerText: "Table for 4?",
      lastAgentText: "Saturday at 7 is open.",
      lastFirstOutputMs: 640,
    });
  });

  it("a turn for an unseen session adds its card", () => {
    const s = applyLiveEvent([], {
      type: "turn",
      sessionId: "s9",
      turnId: "t1",
      callerText: "hi",
      agentText: "hello",
      firstOutputMs: null,
      flags: [],
      at: AT,
    });
    expect(s.map((c) => c.sessionId)).toEqual(["s9"]);
  });

  it("pending then pending_cleared clears the badge and records the outcome", () => {
    let s = applyLiveEvent([], open("s1"));
    s = applyLiveEvent(s, {
      type: "pending",
      sessionId: "s1",
      summary: "Table for 4, Sat 7 PM",
      expiresAt: AT,
    });
    expect(s[0]!.pending).toEqual({ summary: "Table for 4, Sat 7 PM", expiresAt: AT });
    s = applyLiveEvent(s, { type: "pending_cleared", sessionId: "s1", status: "executed" });
    expect(s[0]).toMatchObject({ pending: null, lastAction: "executed" });
  });

  it("handoff marks the card", () => {
    const s = applyLiveEvent(applyLiveEvent([], open("s1")), {
      type: "handoff",
      sessionId: "s1",
      reason: "human_requested",
    });
    expect(s[0]!.handedOff).toBe(true);
  });

  it("session_closed removes the card and leaves the others alone", () => {
    let s = applyLiveEvent(applyLiveEvent([], open("s1")), open("s2"));
    const before = s.find((c) => c.sessionId === "s2");
    s = applyLiveEvent(s, { type: "session_closed", sessionId: "s1", at: AT });
    expect(s.map((c) => c.sessionId)).toEqual(["s2"]);
    expect(s[0]).toBe(before);
  });
});
