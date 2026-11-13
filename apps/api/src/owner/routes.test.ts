import { CalendarUnavailableError } from "@frontdesk/core";
import type { BookingRow, ConversationSummary, MetricsReport } from "@frontdesk/db";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatContext } from "../chat/connection.js";
import { InMemoryConversationLog } from "../chat/conversation-log.js";
import { SessionHub } from "../chat/hub.js";
import { buildServer } from "../server.js";
import { memoryDeps } from "../test-deps.js";
import { calendarEventUrl } from "./calendar-link.js";
import type { OwnerReads } from "./reads.js";
import { ownerRestRoutes } from "./routes.js";
import { testOwner } from "./test-owner.js";

const ORIGIN = "http://localhost:3000";
const EMAIL = "owner@casafiorella.test";
const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-11-04T19:00:00.000Z");
const CAL = "casa@group.calendar.google.com";

const summary: ConversationSummary = {
  id: "sess_1",
  source: "live",
  seeded: false,
  startedAt: "2026-11-04T18:00:00.000Z",
  endedAt: null,
  outcome: null,
  handoffReason: null,
  turnCount: 2,
  lastCallerText: "yes please",
  booked: true,
  costUsd: 0.0001,
};
const bookingRow = (o: Partial<BookingRow>): BookingRow => ({
  actionId: "act_1",
  sessionId: "sess_1",
  seeded: false,
  kind: "book",
  status: "booked",
  reservationId: "7kq2j3",
  name: "Bo Chen",
  contact: "bo@example.com",
  partySize: 4,
  start: "2026-11-07T00:00:00.000Z",
  end: "2026-11-07T01:30:00.000Z",
  executedAt: "2026-11-04T18:01:00.000Z",
  emailed: true,
  voice: false,
  ...o,
});
const report = {
  summary: { conversations: 1 },
  daily: [],
  hasSeeded: false,
} as unknown as MetricsReport;

function fakeReads(): OwnerReads & { [K in keyof OwnerReads]: ReturnType<typeof vi.fn> } {
  return {
    listConversations: vi.fn(() => Promise.resolve([summary])),
    getConversation: vi.fn((id: string) =>
      Promise.resolve(id === "sess_1" ? { summary, turns: [], audit: [], handoff: null } : null),
    ),
    listBookings: vi.fn(() =>
      Promise.resolve([
        bookingRow({}),
        bookingRow({ reservationId: "demo_ev", seeded: true, sessionId: "demo_1" }),
      ]),
    ),
    listHandoffs: vi.fn(() => Promise.resolve([])),
    resolveHandoff: vi.fn((id: string) =>
      Promise.resolve(
        id === "ho_1" ? "resolved" : id === "ho_done" ? "already_resolved" : "not_found",
      ),
    ),
    metrics: vi.fn(() => Promise.resolve(report)),
    listFeedback: vi.fn(() => Promise.resolve([])),
  } as never;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(calendarId: string | null = CAL) {
  const reads = fakeReads();
  const deps = memoryDeps();
  const chat: ChatContext = {
    deps,
    log: new InMemoryConversationLog(),
    price: { input: 0, output: 0 },
    newSessionId: () => "sess_x",
    logger: { error: vi.fn() },
    hub: new SessionHub(),
  };
  app = buildServer({
    chat,
    webOrigins: [ORIGIN],
    logger: false,
    owner: testOwner({ email: EMAIL, passwordHash: bcrypt.hashSync(PASSWORD, 4) }),
    ownerRoutes: [
      ownerRestRoutes({
        reads,
        calendarId,
        now: () => NOW,
        calendar: deps.calendar,
        config: deps.config,
      }),
    ],
  });
  const res = await app.inject({
    method: "POST",
    url: "/owner/login",
    headers: { "content-type": "application/json", origin: ORIGIN },
    payload: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  const get = (url: string) => app!.inject({ url, headers: { cookie } });
  const post = (url: string, body: unknown) =>
    app!.inject({
      method: "POST",
      url,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
  return { reads, deps, get, post };
}

describe("owner REST routes", () => {
  it("lists conversations with the parsed filters", async () => {
    const { reads, get } = await start();
    const res = await get(
      "/owner/conversations?source=pilot&q=anniversary&before=2026-11-04T18:00:00.000Z&limit=20",
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([summary]);
    expect(reads.listConversations).toHaveBeenCalledWith({
      source: "pilot",
      q: "anniversary",
      before: "2026-11-04T18:00:00.000Z",
      limit: 20,
    });
    await get("/owner/conversations");
    expect(reads.listConversations).toHaveBeenLastCalledWith({ source: "live", limit: 50 });
  });

  it("source=eval is a 400", async () => {
    const { reads, get } = await start();
    for (const path of ["conversations", "bookings", "handoffs", "metrics", "feedback"]) {
      const res = await get(`/owner/${path}?source=eval`);
      expect(res.statusCode, path).toBe(400);
    }
    expect(reads.metrics).not.toHaveBeenCalled();
  });

  it("unknown or malformed query fields are a 400", async () => {
    const { get } = await start();
    expect((await get("/owner/conversations?sourc=live")).statusCode).toBe(400);
    expect((await get("/owner/conversations?limit=1000")).statusCode).toBe(400);
    expect((await get("/owner/conversations?before=yesterday")).statusCode).toBe(400);
    expect((await get("/owner/conversations?source=live&source=pilot")).statusCode).toBe(400);
    expect((await get(`/owner/conversations?q=${"a".repeat(201)}`)).statusCode).toBe(400);
    expect((await get("/owner/metrics?days=3")).statusCode).toBe(400);
  });

  it("returns one conversation or 404", async () => {
    const { get } = await start();
    expect((await get("/owner/conversations/sess_1")).json()).toMatchObject({
      summary: { id: "sess_1" },
    });
    expect((await get("/owner/conversations/sess_nope")).statusCode).toBe(404);
  });

  it("bookings carry calendar links, but not for seeded rows", async () => {
    const { get } = await start();
    const rows = (await get("/owner/bookings")).json<
      (BookingRow & { calendarUrl: string | null })[]
    >();
    expect(rows[0]!.calendarUrl).toBe(calendarEventUrl("7kq2j3", CAL));
    expect(rows[1]!.calendarUrl).toBeNull();
  });

  it("bookings have no calendar links without a Google calendar", async () => {
    const { get } = await start(null);
    const rows = (await get("/owner/bookings")).json<{ calendarUrl: string | null }[]>();
    expect(rows.map((r) => r.calendarUrl)).toEqual([null, null]);
  });

  it("handoffs default to the open queue", async () => {
    const { reads, get } = await start();
    await get("/owner/handoffs");
    expect(reads.listHandoffs).toHaveBeenCalledWith({ source: "live", status: "open" });
    await get("/owner/handoffs?status=resolved&source=pilot");
    expect(reads.listHandoffs).toHaveBeenLastCalledWith({ source: "pilot", status: "resolved" });
  });

  it("resolve validates notes length", async () => {
    const { reads, post } = await start();
    const body = (notes: string) => ({ notes, outcome: "booked_by_staff" });
    expect((await post("/owner/handoffs/ho_1/resolve", body("   "))).statusCode).toBe(400);
    expect((await post("/owner/handoffs/ho_1/resolve", body("x".repeat(2001)))).statusCode).toBe(
      400,
    );
    expect(
      (await post("/owner/handoffs/ho_1/resolve", { ...body("ok"), extra: 1 })).statusCode,
    ).toBe(400);
    expect((await post("/owner/handoffs/ho_1/resolve", body("  Called back  "))).statusCode).toBe(
      204,
    );
    expect(reads.resolveHandoff).toHaveBeenCalledWith(
      "ho_1",
      "Called back",
      NOW.toISOString(),
      "booked_by_staff",
    );
    expect((await post("/owner/handoffs/ho_done/resolve", body("again"))).statusCode).toBe(409);
    expect((await post("/owner/handoffs/ho_x/resolve", body("x"))).statusCode).toBe(404);
  });

  it("resolve without outcome is 400", async () => {
    const { reads, post } = await start();
    expect((await post("/owner/handoffs/ho_1/resolve", { notes: "ok" })).statusCode).toBe(400);
    expect(
      (await post("/owner/handoffs/ho_1/resolve", { notes: "ok", outcome: "shrug" })).statusCode,
    ).toBe(400);
    expect(reads.resolveHandoff).not.toHaveBeenCalled();
  });

  it("feedback filters by source", async () => {
    const { reads, get } = await start();
    expect((await get("/owner/feedback")).statusCode).toBe(200);
    expect(reads.listFeedback).toHaveBeenCalledWith({ source: "live", limit: 100 });
    await get("/owner/feedback?source=pilot&limit=20");
    expect(reads.listFeedback).toHaveBeenLastCalledWith({ source: "pilot", limit: 20 });
    expect((await get("/owner/feedback?limit=500")).statusCode).toBe(400);
  });

  it("metrics include the budget", async () => {
    const { reads, get } = await start();
    const body = (await get("/owner/metrics?days=7")).json<{ budget: unknown; summary: unknown }>();
    expect(reads.metrics).toHaveBeenCalledWith({ source: "live", days: 7 });
    expect(body.summary).toEqual({ conversations: 1 });
    expect(body.budget).toEqual({
      stt: { p50: 400, p95: 800 },
      llmTtft: { p50: 700, p95: 1500 },
      tool: { p50: 300, p95: 800 },
      ttsStart: { p50: 150, p95: 300 },
      firstOutput: { p50: 800, p95: 1800 },
    });
  });
});

describe("owner calendar", () => {
  const at = (iso: string) => new Date(iso);

  it("shows the day's reservations from the calendar, joined to their conversations", async () => {
    const { get, deps, reads } = await start();
    const made = await deps.calendar.createReservation({
      start: at("2026-11-07T19:00:00-05:00"),
      end: at("2026-11-07T20:30:00-05:00"),
      tableId: "t4-1",
      partySize: 4,
      name: "Bo Chen",
      contact: "bo@example.com",
      notes: "",
    });
    await deps.calendar.createReservation({
      start: at("2026-11-05T18:00:00-05:00"),
      end: at("2026-11-05T19:30:00-05:00"),
      tableId: "t2-1",
      partySize: 2,
      name: "Ana Ruiz",
      contact: "ana@example.com",
      notes: "",
    });
    reads.listBookings.mockResolvedValue([
      bookingRow({ reservationId: made.id, sessionId: "sess_9", voice: true }),
    ]);
    const res = await get("/owner/calendar?date=2026-11-07");
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      today: string;
      label: string;
      tables: unknown[];
      reservations: unknown[];
      week: { date: string; bookings: number; guests: number }[];
    }>();
    expect(body.today).toBe("2026-11-04");
    expect(body.label).toBe("Saturday, November 7");
    expect(body.tables.length).toBeGreaterThan(0);
    expect(body.reservations).toEqual([
      expect.objectContaining({
        id: made.id,
        name: "Bo Chen",
        startLabel: "7:00 PM",
        sessionId: "sess_9",
        voice: true,
        calendarUrl: calendarEventUrl(made.id, CAL),
      }),
    ]);
    expect(body.week).toHaveLength(7);
    expect(body.week.find((d) => d.date === "2026-11-05")).toMatchObject({
      bookings: 1,
      guests: 2,
    });
  });

  it("a reservation Front Desk has no log of still shows, without a conversation", async () => {
    const { get, deps } = await start(null);
    await deps.calendar.createReservation({
      start: at("2026-11-04T18:00:00-05:00"),
      end: at("2026-11-04T19:30:00-05:00"),
      tableId: "t2-2",
      partySize: 2,
      name: "Walk-in",
      contact: "",
      notes: "",
    });
    const body = (await get("/owner/calendar")).json<{ date: string; reservations: unknown[] }>();
    expect(body.date).toBe("2026-11-04");
    expect(body.reservations).toEqual([
      expect.objectContaining({ name: "Walk-in", sessionId: null, voice: null, calendarUrl: null }),
    ]);
  });

  it("rejects a malformed date, and says when the calendar is down", async () => {
    const { get, deps } = await start();
    expect((await get("/owner/calendar?date=tomorrow")).statusCode).toBe(400);
    vi.spyOn(deps.calendar, "listReservations").mockRejectedValue(
      new CalendarUnavailableError("down"),
    );
    const res = await get("/owner/calendar");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "calendar_unavailable" });
  });
});

describe("calendarEventUrl", () => {
  it("encodes eid as base64url of 'eventId calendarId'", () => {
    expect(calendarEventUrl("7kq2j3", CAL)).toBe(
      "https://www.google.com/calendar/event?eid=N2txMmozIGNhc2FAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ",
    );
  });
});
