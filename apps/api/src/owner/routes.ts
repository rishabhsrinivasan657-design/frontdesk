import { HANDOFF_OUTCOMES } from "@frontdesk/db";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { LATENCY_P50_MS, LATENCY_P95_MS } from "../metrics/latency.js";
import { calendarEventUrl } from "./calendar-link.js";
import type { OwnerRouteSet } from "./plugin.js";
import type { OwnerReads } from "./reads.js";

export interface OwnerRestDeps {
  reads: OwnerReads;
  /** The Google calendar's id; null with the in-memory calendar (no links). */
  calendarId: string | null;
  now(): Date;
}

/** `eval` is not a member: eval data lives in its own database (spec §10). */
const source = z.enum(["live", "pilot"]).default("live");
const id = z.string().min(1).max(200);

const ConversationsQuery = z.strictObject({
  source,
  q: z.string().max(200).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const SourceQuery = z.strictObject({ source });
const HandoffsQuery = z.strictObject({
  source,
  status: z.enum(["open", "resolved"]).default("open"),
});
const MetricsQuery = z.strictObject({
  source,
  days: z.coerce.number().int().min(7).max(90).default(30),
});
const FeedbackQuery = z.strictObject({
  source,
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const ResolveBody = z.strictObject({
  notes: z.string().trim().min(1).max(2000),
  outcome: z.enum(HANDOFF_OUTCOMES),
});
const IdParams = z.strictObject({ id });

/** The spec §8 budget per charted stage, in ms. */
export const BUDGET = {
  stt: { p50: LATENCY_P50_MS.stt, p95: LATENCY_P95_MS.stt },
  llmTtft: { p50: LATENCY_P50_MS.llmTtft, p95: LATENCY_P95_MS.llmTtft },
  tool: { p50: LATENCY_P50_MS.tool, p95: LATENCY_P95_MS.tool },
  ttsStart: { p50: LATENCY_P50_MS.ttsStart, p95: LATENCY_P95_MS.ttsStart },
  firstOutput: { p50: LATENCY_P50_MS.chatFirstToken, p95: LATENCY_P95_MS.chatFirstToken },
} as const;

const badRequest = (reply: FastifyReply) => reply.code(400).send({ error: "bad_request" });

/** The dashboard's REST api (spec §10). Registered inside the owner plugin, so all need auth. */
export function ownerRestRoutes(deps: OwnerRestDeps): OwnerRouteSet {
  return (app) => {
    app.get("/conversations", async (req, reply) => {
      const q = ConversationsQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply);
      const { q: text, before, ...rest } = q.data;
      return deps.reads.listConversations({
        ...rest,
        ...(text?.trim() ? { q: text.trim() } : {}),
        ...(before ? { before: new Date(before).toISOString() } : {}),
      });
    });

    app.get("/conversations/:id", async (req, reply) => {
      const p = IdParams.safeParse(req.params);
      if (!p.success || Object.keys(req.query as object).length > 0) return badRequest(reply);
      const detail = await deps.reads.getConversation(p.data.id);
      return detail ?? reply.code(404).send({ error: "not_found" });
    });

    app.get("/bookings", async (req, reply) => {
      const q = SourceQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply);
      const rows = await deps.reads.listBookings(q.data);
      return rows.map((b) => ({
        ...b,
        // Seeded reservations were never written to Calendar.
        calendarUrl:
          deps.calendarId && !b.seeded ? calendarEventUrl(b.reservationId, deps.calendarId) : null,
      }));
    });

    app.get("/handoffs", async (req, reply) => {
      const q = HandoffsQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply);
      return deps.reads.listHandoffs(q.data);
    });

    app.post("/handoffs/:id/resolve", async (req, reply) => {
      const p = IdParams.safeParse(req.params);
      const body = ResolveBody.safeParse(req.body);
      if (!p.success || !body.success) return badRequest(reply);
      const result = await deps.reads.resolveHandoff(
        p.data.id,
        body.data.notes,
        deps.now().toISOString(),
        body.data.outcome,
      );
      if (result === "not_found") return reply.code(404).send({ error: "not_found" });
      if (result === "already_resolved") return reply.code(409).send({ error: "already_resolved" });
      return reply.code(204).send();
    });

    app.get("/feedback", async (req, reply) => {
      const q = FeedbackQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply);
      return deps.reads.listFeedback(q.data);
    });

    app.get("/metrics", async (req, reply) => {
      const q = MetricsQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply);
      return { ...(await deps.reads.metrics(q.data)), budget: BUDGET };
    });
  };
}
