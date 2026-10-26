import { CalendarUnavailableError, type NewBooking } from "@frontdesk/core";
import type { calendar_v3 } from "@googleapis/calendar";
import { describe, expect, it } from "vitest";
import { createGoogleCalendar, type EventsApi, GoogleCalendar } from "./calendar.js";
import { toEvent } from "./event-mapping.js";

const ana: NewBooking = {
  start: new Date("2026-11-07T00:00:00.000Z"),
  end: new Date("2026-11-07T01:30:00.000Z"),
  tableId: "t4-1",
  partySize: 4,
  name: "Ana Ruiz",
  contact: "ana@example.com",
  notes: "",
};

const httpError = (status: number) =>
  Object.assign(new Error("boom"), { response: { status, data: {} } });
const reject = (e: Error) => () => Promise.reject(e);

/** Records list calls; every other method fails unless overridden. */
function fakeEvents(overrides: Partial<EventsApi> = {}) {
  const listCalls: calendar_v3.Params$Resource$Events$List[] = [];
  const fail = reject(new Error("not stubbed"));
  const events: EventsApi = {
    list: (p) => {
      listCalls.push(p);
      return Promise.resolve({ data: { items: [] } });
    },
    get: fail,
    insert: fail,
    patch: fail,
    delete: fail,
    ...overrides,
  };
  return { events, listCalls };
}

const calendar = (events: EventsApi, tag?: string) =>
  new GoogleCalendar({
    events,
    calendarId: "demo@group.calendar.google.com",
    ...(tag ? { tag } : {}),
  });

describe("GoogleCalendar", () => {
  it("a tagged adapter never lists untagged events", async () => {
    const { events, listCalls } = fakeEvents();
    await calendar(events, "run-1").listReservations({ from: ana.start, to: ana.end });
    expect(listCalls[0]).toMatchObject({
      calendarId: "demo@group.calendar.google.com",
      timeMin: ana.start.toISOString(),
      timeMax: ana.end.toISOString(),
      singleEvents: true,
      privateExtendedProperty: ["frontdesk=1", "frontdesk_run=run-1"],
    });
  });

  it("follows nextPageToken and sorts by start", async () => {
    const later = { ...toEvent({ ...ana, start: new Date("2026-11-07T02:00:00.000Z") }), id: "b" };
    const earlier = { ...toEvent(ana), id: "a" };
    const { events } = fakeEvents({
      list: (p) =>
        Promise.resolve({
          data: p.pageToken ? { items: [earlier] } : { items: [later], nextPageToken: "p2" },
        }),
    });
    const listed = await calendar(events).listReservations({ from: ana.start, to: ana.end });
    expect(listed.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("finds by normalized contact key, then name case-insensitively", async () => {
    const { events, listCalls } = fakeEvents({
      list: (p) => {
        listCalls.push(p);
        return Promise.resolve({
          data: {
            items: [
              { ...toEvent(ana), id: "a" },
              { ...toEvent({ ...ana, name: "Someone Else" }), id: "b" },
            ],
          },
        });
      },
    });
    const found = await calendar(events).findReservations({
      name: "ANA RUIZ",
      contact: " Ana@Example.com ",
    });
    expect(found.map((b) => b.id)).toEqual(["a"]);
    expect(listCalls[0]?.privateExtendedProperty).toEqual([
      "frontdesk=1",
      "contactKey=ana@example.com",
    ]);
  });

  it("moveReservation patches the party size into the private properties", async () => {
    const patches: calendar_v3.Params$Resource$Events$Patch[] = [];
    const stored = { ...toEvent(ana), id: "ev1" };
    const { events } = fakeEvents({
      get: () => Promise.resolve({ data: stored }),
      patch: (p) => {
        patches.push(p);
        return Promise.resolve({ data: { ...p.requestBody, id: "ev1" } });
      },
    });
    const moved = await calendar(events).moveReservation("ev1", {
      start: ana.start,
      end: ana.end,
      tableId: "t2-1",
      partySize: 2,
    });
    expect(moved).toMatchObject({ id: "ev1", tableId: "t2-1", partySize: 2, name: "Ana Ruiz" });
    expect(patches[0]?.requestBody?.extendedProperties?.private).toMatchObject({
      partySize: "2",
      tableId: "t2-1",
    });
    expect(patches[0]?.requestBody?.summary).toBe("Ana Ruiz (party of 2)");
  });

  it("moveReservation without a party size keeps the stored one", async () => {
    const stored = { ...toEvent(ana), id: "ev1" };
    const { events } = fakeEvents({
      get: () => Promise.resolve({ data: stored }),
      patch: (p) => Promise.resolve({ data: { ...p.requestBody, id: "ev1" } }),
    });
    const moved = await calendar(events).moveReservation("ev1", {
      start: ana.start,
      end: ana.end,
      tableId: "t4-2",
      partySize: undefined,
    });
    expect(moved.partySize).toBe(4);
  });

  it("returns undefined for a missing or deleted event", async () => {
    const { events } = fakeEvents({ get: reject(httpError(404)) });
    expect(await calendar(events).getReservation("gone")).toBeUndefined();
    const { events: e410 } = fakeEvents({ get: reject(httpError(410)) });
    expect(await calendar(e410).getReservation("gone")).toBeUndefined();
  });

  it("rejects cancelling an unknown event", async () => {
    const { events } = fakeEvents({ delete: reject(httpError(404)) });
    await expect(calendar(events).cancelReservation("gone")).rejects.toThrow(/404/);
  });

  it("maps a network failure to CalendarUnavailableError", async () => {
    const down = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    const { events } = fakeEvents({ list: reject(down), insert: reject(httpError(503)) });
    await expect(
      calendar(events).listReservations({ from: ana.start, to: ana.end }),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);
    await expect(calendar(events).createReservation(ana)).rejects.toBeInstanceOf(
      CalendarUnavailableError,
    );
  });

  it("refuses an event that is not a Front Desk booking", async () => {
    const { events } = fakeEvents({
      get: () => Promise.resolve({ data: { id: "x", summary: "Dentist", status: "confirmed" } }),
    });
    expect(await calendar(events).getReservation("x")).toBeUndefined();
  });

  it("an untagged adapter ignores events from test runs", async () => {
    const testEvent = { ...toEvent(ana, "test-run"), id: "t", status: "confirmed" };
    const { events } = fakeEvents({
      list: () => Promise.resolve({ data: { items: [testEvent] } }),
      get: () => Promise.resolve({ data: testEvent }),
    });
    expect(await calendar(events).listReservations({ from: ana.start, to: ana.end })).toEqual([]);
    expect(await calendar(events).getReservation("t")).toBeUndefined();
    expect(await calendar(events, "test-run").getReservation("t")).toMatchObject({ id: "t" });
  });
});

describe("createGoogleCalendar", () => {
  it("bounds each call at 10 s with no hidden retries", () => {
    const cal = createGoogleCalendar({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "refresh",
      calendarId: "demo@group.calendar.google.com",
    });
    const options = (cal as unknown as { events: { context: { _options: unknown } } }).events
      .context._options;
    expect(options).toMatchObject({ timeout: 10_000, retry: false });
  });
});
