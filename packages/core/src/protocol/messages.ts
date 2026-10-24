import { z } from "zod";
import { HANDOFF_REASONS } from "../agent/types.js";

/** WebSocket protocol (spec §8). Shared by the api (M6) and the browser client. */

const ACTION_KINDS = ["book", "reschedule", "cancel"] as const;
const ms = z.number().nonnegative();

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("user_text"),
    text: z.string().min(1).max(2000),
    timings: z.strictObject({ speechEnd: ms.optional(), sttFinal: ms.optional() }),
  }),
  z.strictObject({ type: z.literal("interrupt") }),
  z.strictObject({ type: z.literal("tts_started"), turnId: z.string(), at: ms }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("agent_delta"), turnId: z.string(), text: z.string() }),
  z.strictObject({ type: z.literal("agent_sentence"), turnId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal("pending_action"),
    turnId: z.string(),
    actionId: z.string(),
    kind: z.enum(ACTION_KINDS),
    summary: z.string(),
    expiresAt: z.string(),
  }),
  z.strictObject({
    type: z.literal("action_result"),
    turnId: z.string(),
    actionId: z.string(),
    kind: z.enum(ACTION_KINDS),
    status: z.enum(["executed", "failed", "voided"]),
    reason: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("handoff"),
    turnId: z.string(),
    reason: z.enum(HANDOFF_REASONS),
    message: z.string(),
  }),
  z.strictObject({
    type: z.literal("turn_metrics"),
    turnId: z.string(),
    llmTtftMs: ms.optional(),
    llmTotalMs: ms,
    toolMs: z.array(ms),
    totalMs: ms,
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
  }),
  /** Sent once per socket: the server-issued session id and the state to restore (spec §11). */
  z.strictObject({
    type: z.literal("session"),
    sessionId: z.string(),
    resumed: z.boolean(),
    transcript: z.array(
      z.strictObject({
        role: z.enum(["caller", "agent"]),
        text: z.string(),
        turnId: z.string(),
      }),
    ),
    pending: z
      .strictObject({
        actionId: z.string(),
        kind: z.enum(ACTION_KINDS),
        summary: z.string(),
        expiresAt: z.string(),
      })
      .optional(),
    handoff: z.strictObject({ reason: z.enum(HANDOFF_REASONS), message: z.string() }).optional(),
  }),
  /** The in-flight turn was cancelled by `interrupt`: nothing from it will follow. */
  z.strictObject({ type: z.literal("interrupted") }),
  z.strictObject({
    type: z.literal("error"),
    code: z.enum(["bad_message", "busy", "server_error"]),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type SessionMessage = Extract<ServerMessage, { type: "session" }>;
