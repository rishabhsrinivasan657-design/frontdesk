import type { ServerMessage } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { type ChatEvent, type ChatState, chatReducer, initialChatState } from "./state";

const server = (message: ServerMessage, at = 0): ChatEvent => ({ type: "server", message, at });
const run = (events: ChatEvent[], from: ChatState = initialChatState) =>
  events.reduce(chatReducer, from);

const pending = {
  type: "pending_action",
  turnId: "turn_2",
  actionId: "act_1",
  kind: "book",
  summary: "To confirm: a table for 4 on Saturday, November 7 at 7:00 PM. Shall I book it?",
  expiresAt: "2026-11-04T14:05:00-05:00",
} as const;

const metrics = (turnId: string, totalMs = 900): ServerMessage => ({
  type: "turn_metrics",
  turnId,
  llmTtftMs: 300,
  llmTotalMs: 600,
  toolMs: [],
  totalMs,
  tokensIn: 10,
  tokensOut: 5,
});

describe("chatReducer", () => {
  it("session message restores transcript, pending and handoff", () => {
    const state = run([
      server({
        type: "session",
        sessionId: "sess_1",
        resumed: true,
        transcript: [
          { role: "caller", text: "Hi", turnId: "turn_1" },
          { role: "agent", text: "Hello.", turnId: "turn_1" },
        ],
        pending: {
          actionId: "act_1",
          kind: "book",
          summary: pending.summary,
          expiresAt: pending.expiresAt,
        },
        handoff: { reason: "human_requested", message: "Passing you on." },
      }),
    ]);
    expect(state.status).toBe("open");
    expect(state.sessionId).toBe("sess_1");
    expect(state.messages.map((m) => [m.role, m.text])).toEqual([
      ["caller", "Hi"],
      ["agent", "Hello."],
    ]);
    expect(state.pending).toMatchObject({ actionId: "act_1", summary: pending.summary });
    expect(state.handoff).toEqual({ reason: "human_requested", message: "Passing you on." });
  });

  it("a local send shows the caller's text at once and marks the turn busy", () => {
    const state = run([{ type: "local_send", text: "Table for 4?", at: 10 }]);
    expect(state.messages).toEqual([
      expect.objectContaining({ role: "caller", text: "Table for 4?" }),
    ]);
    expect(state.busy).toBe(true);
  });

  it("interrupted clears busy without a notice", () => {
    const state = run([
      { type: "local_send", text: "Table for 4?", at: 10 },
      server({ type: "interrupted" }),
    ]);
    expect(state.busy).toBe(false);
    expect(state.notice).toBeUndefined();
    expect(state.messages).toHaveLength(1);
  });

  it("sentences of one turn join one agent bubble", () => {
    const state = run([
      server({ type: "agent_sentence", turnId: "turn_1", text: "That time is open." }),
      server({ type: "agent_sentence", turnId: "turn_1", text: "What name should I use?" }),
      server({ type: "agent_sentence", turnId: "turn_2", text: "Thanks." }),
    ]);
    expect(state.messages.map((m) => m.text)).toEqual([
      "That time is open. What name should I use?",
      "Thanks.",
    ]);
  });

  it("deltas append to the turn's bubble without spaces", () => {
    const state = run([
      server({ type: "agent_delta", turnId: "turn_1", text: "Hel" }),
      server({ type: "agent_delta", turnId: "turn_1", text: "lo." }),
    ]);
    expect(state.messages.map((m) => m.text)).toEqual(["Hello."]);
  });

  it("a pending action shows a card; executed closes it", () => {
    const shown = run([server(pending)]);
    expect(shown.pending?.outcome).toBeUndefined();
    const done = run(
      [
        server({
          type: "action_result",
          turnId: "turn_3",
          actionId: "act_1",
          kind: "book",
          status: "executed",
        }),
      ],
      shown,
    );
    expect(done.pending?.outcome).toBe("executed");
  });

  it("voided action_result closes the card", () => {
    const state = run([
      server(pending),
      server({
        type: "action_result",
        turnId: "turn_3",
        actionId: "act_1",
        kind: "book",
        status: "voided",
        reason: "change",
      }),
    ]);
    expect(state.pending).toMatchObject({ outcome: "voided", reason: "change" });
  });

  it("ignores a result for an action the card isn't showing", () => {
    const state = run([
      server(pending),
      server({
        type: "action_result",
        turnId: "turn_3",
        actionId: "act_9",
        kind: "book",
        status: "executed",
      }),
    ]);
    expect(state.pending?.outcome).toBeUndefined();
  });

  it("turn_metrics clears busy and records latency measured from the send", () => {
    const state = run([
      { type: "local_send", text: "Hi", at: 1000 },
      server({ type: "agent_sentence", turnId: "turn_1", text: "Hello." }, 1640),
      server(metrics("turn_1", 1200), 1700),
    ]);
    expect(state.busy).toBe(false);
    expect(state.lastLatency).toEqual({ firstReplyMs: 640, totalMs: 1200, llmTtftMs: 300 });
  });

  it("handoff shows the banner", () => {
    const state = run([
      server({
        type: "handoff",
        turnId: "turn_1",
        reason: "complaint",
        message: "Passing you on.",
      }),
    ]);
    expect(state.handoff?.message).toBe("Passing you on.");
  });

  it("busy and server errors clear busy and show a notice", () => {
    for (const code of ["busy", "server_error", "bad_message"] as const) {
      const state = run([
        { type: "local_send", text: "Hi", at: 0 },
        server({ type: "error", code, message: "Oops." }),
      ]);
      expect(state.busy).toBe(false);
      expect(state.notice).toBe("Oops.");
    }
  });

  it("a busy error removes the caller's message the server refused", () => {
    const state = run([
      { type: "local_send", text: "Hi", at: 0 },
      server({ type: "agent_sentence", turnId: "turn_1", text: "Hello." }),
      server(metrics("turn_1")),
      { type: "local_send", text: "Yes, please", at: 5 },
      server({ type: "error", code: "busy", message: "Still answering your last message." }),
    ]);
    expect(state.messages.map((m) => m.text)).toEqual(["Hi", "Hello."]);
  });

  it("a dropped socket shows reconnecting and frees the composer", () => {
    const state = run([
      { type: "local_send", text: "Hi", at: 0 },
      { type: "socket", status: "reconnecting" },
    ]);
    expect(state.status).toBe("reconnecting");
    expect(state.busy).toBe(false);
  });
});
