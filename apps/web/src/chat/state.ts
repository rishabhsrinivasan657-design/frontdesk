import type { ServerMessage } from "@frontdesk/core";

type ActionKind = "book" | "reschedule" | "cancel";

export interface ChatMessage {
  id: string;
  role: "caller" | "agent";
  text: string;
  turnId?: string;
}

/** The read-back waiting for the caller, and what became of it. */
export interface PendingCard {
  actionId: string;
  kind: ActionKind;
  summary: string;
  expiresAt: string;
  outcome?: "executed" | "failed" | "voided";
  reason?: string;
}

export interface Latency {
  /** Measured in the browser: send → first reply text. */
  firstReplyMs?: number;
  /** The server's whole turn. */
  totalMs: number;
  llmTtftMs?: number;
}

export interface ChatState {
  status: "connecting" | "open" | "reconnecting" | "replaced";
  sessionId?: string;
  messages: ChatMessage[];
  pending?: PendingCard;
  handoff?: { reason: string; message: string };
  /** A turn is running; the composer waits. */
  busy: boolean;
  sentAt?: number;
  firstReplyAt?: number;
  lastLatency?: Latency;
  /** A short message for the caller (an error the server reported). */
  notice?: string;
}

export type ChatEvent =
  | { type: "server"; message: ServerMessage; at: number }
  | { type: "local_send"; text: string; at: number }
  | { type: "socket"; status: "reconnecting" | "replaced" };

export const initialChatState: ChatState = { status: "connecting", messages: [], busy: false };

let localIds = 0;

/** All chat UI state, driven by what the server sends and what the caller does. */
export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "local_send": {
      const message: ChatMessage = { id: `local-${++localIds}`, role: "caller", text: event.text };
      return {
        ...state,
        messages: [...state.messages, message],
        busy: true,
        sentAt: event.at,
        firstReplyAt: undefined,
        notice: undefined,
      };
    }
    case "socket":
      return { ...state, status: event.status, busy: false };
    case "server":
      return onServer(state, event.message, event.at);
  }
}

function onServer(state: ChatState, m: ServerMessage, at: number): ChatState {
  switch (m.type) {
    case "session": {
      return {
        ...state,
        status: "open",
        sessionId: m.sessionId,
        busy: false,
        messages: m.transcript.map((t, i) => ({
          id: `${t.turnId}-${t.role}-${i}`,
          role: t.role,
          text: t.text,
          turnId: t.turnId,
        })),
        pending: m.pending ? { ...m.pending } : undefined,
        handoff: m.handoff,
        notice: undefined,
      };
    }
    case "agent_sentence":
      return appendAgent(firstReply(state, at), m.turnId, m.text, " ");
    case "agent_delta":
      return appendAgent(firstReply(state, at), m.turnId, m.text, "");
    case "pending_action":
      return {
        ...firstReply(state, at),
        pending: {
          actionId: m.actionId,
          kind: m.kind,
          summary: m.summary,
          expiresAt: m.expiresAt,
        },
      };
    case "action_result":
      if (state.pending?.actionId !== m.actionId) return state;
      return {
        ...state,
        pending: {
          ...state.pending,
          outcome: m.status,
          ...(m.reason !== undefined ? { reason: m.reason } : {}),
        },
      };
    case "handoff":
      return { ...firstReply(state, at), handoff: { reason: m.reason, message: m.message } };
    case "turn_metrics": {
      const firstReplyMs =
        state.sentAt !== undefined && state.firstReplyAt !== undefined
          ? Math.round(state.firstReplyAt - state.sentAt)
          : undefined;
      return {
        ...state,
        busy: false,
        lastLatency: {
          ...(firstReplyMs !== undefined ? { firstReplyMs } : {}),
          totalMs: Math.round(m.totalMs),
          ...(m.llmTtftMs !== undefined ? { llmTtftMs: Math.round(m.llmTtftMs) } : {}),
        },
      };
    }
    case "error":
      return { ...state, busy: false, notice: m.message };
  }
}

function firstReply(state: ChatState, at: number): ChatState {
  return state.busy && state.firstReplyAt === undefined ? { ...state, firstReplyAt: at } : state;
}

function appendAgent(state: ChatState, turnId: string, text: string, joiner: string): ChatState {
  const last = state.messages.at(-1);
  if (last?.role === "agent" && last.turnId === turnId) {
    const merged = { ...last, text: last.text ? `${last.text}${joiner}${text}` : text };
    return { ...state, messages: [...state.messages.slice(0, -1), merged] };
  }
  const message: ChatMessage = { id: `${turnId}-agent`, role: "agent", text, turnId };
  return { ...state, messages: [...state.messages, message] };
}
