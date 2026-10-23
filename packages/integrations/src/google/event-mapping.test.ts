import type { NewBooking } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { fromEvent, toEvent } from "./event-mapping.js";

const ana: NewBooking = {
  start: new Date("2026-11-07T00:00:00.000Z"),
  end: new Date("2026-11-07T01:30:00.000Z"),
  tableId: "t4-1",
  partySize: 4,
  name: "Ana Ruiz",
  contact: "(555) 010-2000",
  notes: "Window seat",
};

describe("event mapping", () => {
  it("round-trips a booking through toEvent/fromEvent", () => {
    const event = { ...toEvent(ana), id: "evt1", status: "confirmed" };
    expect(fromEvent(event)).toEqual({ ...ana, id: "evt1" });
  });

  it("stores details in extendedProperties.private with a normalized contact key", () => {
    expect(toEvent(ana, "run-1").extendedProperties?.private).toEqual({
      frontdesk: "1",
      partySize: "4",
      tableId: "t4-1",
      name: "Ana Ruiz",
      contact: "(555) 010-2000",
      contactKey: "5550102000",
      notes: "Window seat",
      frontdesk_run: "run-1",
    });
  });

  it("invites nobody, so Google never emails the guest", () => {
    expect(toEvent(ana).attendees).toBeUndefined();
  });

  it("ignores cancelled and non-frontdesk events", () => {
    const event = { ...toEvent(ana), id: "evt1" };
    expect(fromEvent({ ...event, status: "cancelled" })).toBeUndefined();
    expect(
      fromEvent({ id: "x", summary: "Dentist", start: event.start, end: event.end }),
    ).toBeUndefined();
  });
});
