import { randomUUID } from "node:crypto";
import type { Calendar } from "@frontdesk/core";
import { runCalendarContract } from "@frontdesk/core/testing";
import { expect } from "vitest";
import { createGoogleCalendar, type GoogleCalendar } from "./calendar.js";
import { liveGoogleEnv } from "./live-env.js";

const env = liveGoogleEnv();
// Every event this run creates carries this tag; the adapter only ever sees tagged events.
const tag = `test-${randomUUID()}`;
const created = new Set<string>();
let calendar: GoogleCalendar | undefined;

/** Records every id the contract creates so afterEach can delete it, even after a failed assertion. */
function tracked(cal: GoogleCalendar): Calendar {
  return new Proxy(cal, {
    get(target, prop, receiver) {
      if (prop === "createReservation") {
        return async (...args: Parameters<Calendar["createReservation"]>) => {
          const booking = await target.createReservation(...args);
          created.add(booking.id);
          return booking;
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

runCalendarContract(
  "Google",
  () => {
    calendar ??= createGoogleCalendar(env!, { tag });
    return tracked(calendar);
  },
  {
    skip: env === undefined,
    afterEach: async () => {
      if (!calendar) return;
      for (const id of created) {
        await calendar.cancelReservation(id).catch(() => undefined); // already cancelled → fine
      }
      created.clear();
      const leftovers = await calendar.listReservations({
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2028-01-01T00:00:00Z"),
      });
      expect(leftovers, "test events left on the demo calendar").toEqual([]);
    },
  },
);
