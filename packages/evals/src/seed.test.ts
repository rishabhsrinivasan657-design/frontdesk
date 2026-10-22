import { TestLLM } from "@frontdesk/core/testing";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { ScenarioSchema, type SeedReservation } from "./scenario.js";
import { localToDate, seedWorld, toLocal } from "./seed.js";

const config = loadConfig();
const TZ = "America/New_York";

function scenario(reservations: SeedReservation[], now = "2026-10-28T14:00:00-04:00") {
  return ScenarioSchema.parse({
    id: "s",
    category: "booking",
    persona: "p",
    goal: "g",
    seed: { now, reservations },
    expect: { outcome: "booked" },
  });
}

describe("seedWorld", () => {
  it("reads seed times in the business time zone across DST", () => {
    expect(localToDate("2026-11-06T19:00", TZ).toISOString()).toBe(
      new Date("2026-11-06T19:00:00-05:00").toISOString(),
    );
    expect(localToDate("2026-10-30T19:00", TZ).toISOString()).toBe(
      new Date("2026-10-30T19:00:00-04:00").toISOString(),
    );
    expect(toLocal(new Date("2026-10-30T23:00:00Z"), TZ)).toBe("2026-10-30T19:00");
  });

  it("assigns distinct tables to overlapping seeds of the same size", () => {
    const { seeded } = seedWorld(
      scenario([
        { name: "Ana Ruiz", start: "2026-10-30T19:00", party: 4 },
        { name: "Ben Ode", start: "2026-10-30T19:30", party: 3 },
        { name: "Cy Lee", start: "2026-10-30T21:00", party: 4 },
      ]),
      config,
      new TestLLM(),
    );
    expect(seeded.map((b) => b.tableId)).toEqual(["t4-1", "t4-2", "t4-1"]);
    expect(seeded.map((b) => b.id)).toEqual(["seed_1", "seed_2", "seed_3"]);
    expect(seeded[0]!.end.getTime() - seeded[0]!.start.getTime()).toBe(90 * 60_000);
  });

  it("defaults contact from the first name and keeps an explicit one", () => {
    const { seeded } = seedWorld(
      scenario([
        { name: "Ana Ruiz", start: "2026-10-30T19:00", party: 2 },
        { name: "Ben Ode", start: "2026-10-30T19:00", party: 2, contact: "+1 555 0100" },
      ]),
      config,
      new TestLLM(),
    );
    expect(seeded.map((b) => b.contact)).toEqual(["ana@example.com", "+1 555 0100"]);
  });

  it("fixes the clock at seed.now and puts seeds in the calendar", async () => {
    const world = seedWorld(
      scenario([{ name: "Ana Ruiz", start: "2026-10-30T19:00", party: 2 }]),
      config,
      new TestLLM(),
    );
    expect(world.deps.clock.now().toISOString()).toBe("2026-10-28T18:00:00.000Z");
    expect(await world.deps.calendar.getReservation("seed_1")).toMatchObject({ name: "Ana Ruiz" });
    expect(world.deps.calendar.writes).toEqual([]);
  });

  it("throws when a seed fits no table", () => {
    expect(() =>
      seedWorld(
        scenario([{ name: "Big Group", start: "2026-10-30T19:00", party: 7 }]),
        config,
        new TestLLM(),
      ),
    ).toThrow(/Big Group/);
  });
});
