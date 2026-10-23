import { afterEach, describe, expect, it } from "vitest";
import type { Calendar, NewBooking } from "../ports/calendar.js";

const at = (iso: string) => new Date(iso);

const ana: NewBooking = {
  start: at("2026-11-06T19:00:00-05:00"),
  end: at("2026-11-06T20:30:00-05:00"),
  tableId: "t4-1",
  partySize: 4,
  name: "Ana Ruiz",
  contact: "555-010-2000",
  notes: "",
};

export interface ContractOptions {
  /** Runs after each test, e.g. to delete the events a real calendar test created. */
  afterEach?: () => Promise<void>;
  /** Skips the whole suite, e.g. when credentials for a real adapter are missing. */
  skip?: boolean;
}

/** Shared behavior every Calendar implementation must have (in-memory and Google). */
export function runCalendarContract(
  name: string,
  make: () => Calendar | Promise<Calendar>,
  opts: ContractOptions = {},
): void {
  describe.skipIf(opts.skip ?? false)(`${name} Calendar contract`, () => {
    if (opts.afterEach) afterEach(opts.afterEach);

    it("create then get returns the booking with an id", async () => {
      const cal = await make();
      const created = await cal.createReservation(ana);
      expect(created.id).toEqual(expect.any(String));
      expect(await cal.getReservation(created.id)).toEqual(created);
      expect(created).toMatchObject({ name: "Ana Ruiz", tableId: "t4-1", partySize: 4 });
    });

    it("listReservations returns only bookings overlapping [from, to)", async () => {
      const cal = await make();
      const inside = await cal.createReservation(ana);
      await cal.createReservation({
        ...ana,
        start: at("2026-11-07T19:00:00-05:00"),
        end: at("2026-11-07T20:30:00-05:00"),
      });
      const listed = await cal.listReservations({
        from: at("2026-11-06T00:00:00-05:00"),
        to: at("2026-11-07T00:00:00-05:00"),
      });
      expect(listed.map((b) => b.id)).toEqual([inside.id]);
      const touching = await cal.listReservations({
        from: at("2026-11-06T20:30:00-05:00"),
        to: at("2026-11-06T21:00:00-05:00"),
      });
      expect(touching).toEqual([]);
    });

    it("findReservations matches name case-insensitively and contact by normalized form", async () => {
      const cal = await make();
      const created = await cal.createReservation(ana);
      const found = await cal.findReservations({ name: "ana ruiz", contact: "(555) 010-2000" });
      expect(found.map((b) => b.id)).toEqual([created.id]);
      expect(await cal.findReservations({ name: "Ana Ruiz", contact: "555-999-0000" })).toEqual([]);
    });

    it("moveReservation updates start, end and table", async () => {
      const cal = await make();
      const created = await cal.createReservation(ana);
      const to = {
        start: at("2026-11-07T19:00:00-05:00"),
        end: at("2026-11-07T20:30:00-05:00"),
        tableId: "t4-2",
      };
      const moved = await cal.moveReservation(created.id, to);
      expect(moved).toMatchObject({ id: created.id, ...to, name: "Ana Ruiz" });
      expect(await cal.getReservation(created.id)).toEqual(moved);
    });

    it("cancelReservation removes the booking from get and list", async () => {
      const cal = await make();
      const created = await cal.createReservation(ana);
      await cal.cancelReservation(created.id);
      expect(await cal.getReservation(created.id)).toBeUndefined();
      const listed = await cal.listReservations({
        from: at("2026-11-06T00:00:00-05:00"),
        to: at("2026-11-07T00:00:00-05:00"),
      });
      expect(listed).toEqual([]);
    });

    it("move and cancel of an unknown id reject", async () => {
      const cal = await make();
      await expect(
        cal.moveReservation("missing", { start: ana.start, end: ana.end, tableId: "t4-1" }),
      ).rejects.toThrow();
      await expect(cal.cancelReservation("missing")).rejects.toThrow();
    });
  });
}
