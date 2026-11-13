import {
  type BusinessConfig,
  type Calendar,
  CalendarUnavailableError,
  dayRange,
  dayView,
  localToday,
  weekStrip,
} from "@frontdesk/core";
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
  /** The restaurant's calendar (read only here) and config, for the owner's day view. */
  calendar: Pick<Calendar, "listReservations">;
  config: BusinessConfig;
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
const CalendarQuery = z.strictObject({
  source,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

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

    app.get("/calendar", async (req, reply) => {
      const q = CalendarQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply);
      const { config } = deps;
      const today = localToday(deps.now(), config.business.timezone);
      const date = q.data.date ?? today;
      const week = weekStrip(config, today, []);
      const span = {
        from: dayRange(config, today).from,
        to: dayRange(config, week.at(-1)!.date).to,
      };
      let inWeek, onDay;
      try {
        inWeek = await deps.calendar.listReservations(span);
        onDay = week.some((d) => d.date === date)
          ? inWeek
          : await deps.calendar.listReservations(dayRange(config, date));
      } catch (error) {
        if (error instanceof CalendarUnavailableError) {
          return reply.code(503).send({ error: "calendar_unavailable" });
        }
        throw error;
      }
      // What Front Desk knows about each booking it made: its conversation, voice or chat, email.
      const logged = new Map(
        (await deps.reads.listBookings({ source: q.data.source })).map((b) => [b.reservationId, b]),
      );
      const view = dayView(config, date, onDay);
      return {
        ...view,
        today,
        week: weekStrip(config, today, inWeek),
        reservations: view.reservations.map((r) => {
          const b = logged.get(r.id);
          return {
            ...r,
            sessionId: b?.sessionId ?? null,
            voice: b?.voice ?? null,
            bookedAt: b?.executedAt ?? null,
            emailed: b?.emailed ?? null,
            calendarUrl: deps.calendarId ? calendarEventUrl(r.id, deps.calendarId) : null,
          };
        }),
      };
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
