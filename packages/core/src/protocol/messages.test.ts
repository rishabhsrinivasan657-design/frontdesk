import { describe, expect, it } from "vitest";
import { ClientMessageSchema, type ServerMessage, ServerMessageSchema } from "./messages.js";

const server: ServerMessage[] = [
  { type: "agent_delta", turnId: "turn_1", text: "Hel" },
  { type: "interrupted" },
  { type: "agent_sentence", turnId: "turn_1", text: "Hello there." },
  {
    type: "pending_action",
    turnId: "turn_1",
    actionId: "act_1",
    kind: "book",
    summary: "To confirm: …",
    expiresAt: "2026-11-04T14:05:00-05:00",
  },
  { type: "action_result", turnId: "turn_2", actionId: "act_1", kind: "book", status: "executed" },
  {
    type: "action_result",
    turnId: "turn_2",
    actionId: "act_1",
    kind: "book",
    status: "failed",
    reason: "slot_taken",
  },
  { type: "handoff", turnId: "turn_3", reason: "complaint", message: "Passing you on." },
  {
    type: "turn_metrics",
    turnId: "turn_3",
    llmTtftMs: 120,
    llmTotalMs: 400,
    toolMs: [12, 30],
    totalMs: 450,
    tokensIn: 900,
    tokensOut: 40,
  },
];

describe("ServerMessageSchema", () => {
  it.each(server.map((m) => [m.type, m] as const))("round-trips %s", (_type, message) => {
    expect(ServerMessageSchema.parse(message)).toEqual(message);
  });

  it("rejects an unknown type", () => {
    expect(ServerMessageSchema.safeParse({ type: "agent_shout", turnId: "t" }).success).toBe(false);
  });

  it("rejects a handoff reason outside HANDOFF_REASONS", () => {
    const bad = { type: "handoff", turnId: "t", reason: "bored", message: "x" };
    expect(ServerMessageSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    const bad = { type: "agent_delta", turnId: "t", text: "x", extra: 1 };
    expect(ServerMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ClientMessageSchema", () => {
  it("accepts user_text, interrupt and tts_started", () => {
    for (const m of [
      { type: "user_text", text: "hi", timings: { speechEnd: 1, sttFinal: 2 } },
      { type: "user_text", text: "hi", timings: {} },
      { type: "interrupt" },
      { type: "tts_started", turnId: "turn_1", at: 1730000000000 },
    ]) {
      expect(ClientMessageSchema.parse(m)).toEqual(m);
    }
  });

  it("rejects empty and over-long user_text", () => {
    const empty = { type: "user_text", text: "", timings: {} };
    const long = { type: "user_text", text: "x".repeat(2001), timings: {} };
    expect(ClientMessageSchema.safeParse(empty).success).toBe(false);
    expect(ClientMessageSchema.safeParse(long).success).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ type: "user_text", text: "x".repeat(2000), timings: {} })
        .success,
    ).toBe(true);
  });
});

describe("feedback (M10)", () => {
  const feedback = (rating: number, comment = "") => ({ type: "feedback", rating, comment });

  it("accepts a 1 to 5 rating with an optional comment", () => {
    expect(ClientMessageSchema.safeParse(feedback(1)).success).toBe(true);
    expect(ClientMessageSchema.safeParse(feedback(5, "x".repeat(1000))).success).toBe(true);
  });

  it("rejects ratings outside 1 to 5, fractions and long comments", () => {
    for (const bad of [feedback(0), feedback(6), feedback(2.5), feedback(3, "x".repeat(1001))]) {
      expect(ClientMessageSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("acknowledges with feedback_saved", () => {
    expect(ServerMessageSchema.safeParse({ type: "feedback_saved" }).success).toBe(true);
  });
});

describe("session and error messages (M6)", () => {
  const session = {
    type: "session",
    sessionId: "sess_1",
    resumed: true,
    transcript: [{ role: "caller", text: "Hi", turnId: "turn_1" }],
    pending: {
      actionId: "act_1",
      kind: "book",
      summary: "To confirm: …",
      expiresAt: "2026-11-04T14:05:00-05:00",
    },
  } as const;

  it("parses a resumed session message with a pending action", () => {
    expect(ServerMessageSchema.parse(session)).toEqual(session);
  });

  it("parses a session message after a handoff", () => {
    const m = {
      type: "session",
      sessionId: "sess_1",
      resumed: true,
      transcript: [],
      handoff: { reason: "human_requested", message: "Passing you on." },
    };
    expect(ServerMessageSchema.parse(m)).toEqual(m);
  });

  it("rejects a session message with an unknown field", () => {
    expect(ServerMessageSchema.safeParse({ ...session, admin: true }).success).toBe(false);
  });

  it("parses an error message", () => {
    const m = { type: "error", code: "busy", message: "One moment." };
    expect(ServerMessageSchema.parse(m)).toEqual(m);
  });

  it("rejects an unknown error code", () => {
    expect(
      ServerMessageSchema.safeParse({ type: "error", code: "teapot", message: "x" }).success,
    ).toBe(false);
  });
});
