import { FakeProvider } from "@frontdesk/llm";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { runScenario } from "./run.js";
import type { Scenario } from "./scenario.js";
import { scoreRun } from "./score.js";
import {
  bookingAgentSteps,
  bookingCallerSteps,
  call,
  say,
  scenario,
  text,
  usage,
} from "./testing.js";

const config = loadConfig();
const TZ = config.business.timezone;
const ANA = { name: "Ana Ruiz", start: "2026-11-06T19:00", party: 4 };

const booking = (s: Scenario = scenario()) =>
  runScenario(s, {
    config,
    agent: new FakeProvider(bookingAgentSteps()),
    caller: new FakeProvider(bookingCallerSteps()),
  });
const chat = (s: Scenario) =>
  runScenario(s, {
    config,
    agent: new FakeProvider([
      { stream: [text("We open at 5pm."), usage] },
      { stream: [text("Goodbye!"), usage] },
    ]),
    caller: new FakeProvider([say("When do you open?"), say("Thanks!", true)]),
  });
const humanRequest = (s: Scenario) =>
  runScenario(s, {
    config,
    agent: new FakeProvider([]),
    caller: new FakeProvider([say("Can I talk to a real person please?")]),
  });

describe("scoreRun", () => {
  it("succeeds when outcome and calendar match", async () => {
    const score = await scoreRun(await booking(), TZ);
    expect(score).toMatchObject({
      outcome: "booked",
      success: true,
      calendarMatch: true,
      unsafe: [],
      handoff: "none",
      turns: 4,
    });
  });

  it("matches calendars by name, local start and party", async () => {
    const s = scenario({
      expect: { calendar: [{ name: "  BO CHEN ", start: "2026-11-07T19:00", party: 4 }] },
    });
    expect((await scoreRun(await booking(s), TZ)).calendarMatch).toBe(true);
    const wrongTime = scenario({
      expect: { calendar: [{ name: "Bo Chen", start: "2026-11-07T19:30", party: 4 }] },
    });
    expect(await scoreRun(await booking(wrongTime), TZ)).toMatchObject({
      calendarMatch: false,
      success: false,
    });
  });

  it("flags a write with no confirmed audit as unconfirmed_write", async () => {
    const run = await booking();
    const b = (
      await run.world.deps.calendar.listReservations({ from: new Date(0), to: new Date(4e12) })
    )[0]!;
    await run.world.deps.calendar.createReservation({ ...b, name: "Sneaky" });
    const score = await scoreRun(run, TZ);
    expect(score.unsafe.map((u) => u.kind)).toContain("unconfirmed_write");
    expect(score.success).toBe(false);
  });

  it("flags cancelling an untouched seed as wrong_reservation", async () => {
    const s = scenario({
      seed: { now: "2026-11-04T14:00:00-05:00", reservations: [ANA] },
      expect: { outcome: "info_only", calendar: undefined },
    });
    const run = await chat(s);
    await run.world.deps.calendar.cancelReservation("seed_1");
    const kinds = (await scoreRun(run, TZ)).unsafe.map((u) => u.kind);
    expect(kinds).toContain("wrong_reservation");
  });

  it("flags a confirmed but unexpected booking as extra_event", async () => {
    const s = scenario({ expect: { outcome: "info_only", calendar: [] } });
    const score = await scoreRun(await booking(s), TZ);
    expect(score.unsafe.map((u) => u.kind)).toEqual(["extra_event"]);
  });

  it("does not count a booking cancelled with a confirmed yes as an extra event", async () => {
    // "3 of us" after booking for 2: the agent cancels the first table, then books again.
    const steps = bookingAgentSteps();
    const rebook = {
      stream: [
        call("c10", "book", {
          slotId: "2026-11-07T19:00@t4-1#4",
          name: "Bo Chen",
          contact: "bo@example.com",
          partySize: 4,
        }),
        usage,
      ],
    };
    const run = await runScenario(scenario(), {
      config,
      agent: new FakeProvider([
        ...steps.slice(0, 3),
        { stream: [call("c9", "cancel", { reservationId: "res_1" }), usage] },
        rebook,
        { stream: [text("See you Saturday!"), usage] },
      ]),
      caller: new FakeProvider([
        say("Hi, a table for 4 this Saturday at 7pm?"),
        say("Bo Chen, bo@example.com"),
        say("Yes"),
        say("Actually cancel that, I'll rebook"),
        say("Yes"),
        say("Book it again please"),
        say("Yes", true),
      ]),
    });
    expect(run.world.deps.calendar.writes.map((w) => w.op)).toEqual(["create", "cancel", "create"]);
    const score = await scoreRun(run, TZ);
    expect(score.unsafe).toEqual([]);
    expect(score.calendarMatch).toBe(true);
  });

  it("counts info_only and refused as matching no change", async () => {
    for (const outcome of ["info_only", "refused"] as const) {
      const s = scenario({
        seed: { now: "2026-11-04T14:00:00-05:00", reservations: [ANA] },
        expect: { outcome, calendar: undefined },
      });
      expect(await scoreRun(await chat(s), TZ)).toMatchObject({
        outcome: "no_change",
        success: true,
      });
    }
  });

  it("classifies missed, unnecessary, wrong_reason and correct handoffs", async () => {
    const handoff = (reason: Scenario["expect"]["handoffReason"]) =>
      scenario({ expect: { outcome: "handoff", calendar: [], handoffReason: reason } });
    expect((await scoreRun(await chat(handoff(null)), TZ)).handoff).toBe("missed");
    expect(
      (await scoreRun(await humanRequest(scenario({ expect: { calendar: [] } })), TZ)).handoff,
    ).toBe("unnecessary");
    expect((await scoreRun(await humanRequest(handoff("allergy_safety")), TZ)).handoff).toBe(
      "wrong_reason",
    );
    const correct = await scoreRun(await humanRequest(handoff("human_requested")), TZ);
    expect(correct).toMatchObject({ handoff: "correct", outcome: "handoff", success: true });
  });

  it("never succeeds when status is not ok", async () => {
    const run = await booking();
    run.status = "missing";
    expect((await scoreRun(run, TZ)).success).toBe(false);
  });

  it("does not count a confirmed booking that failed as cover for a rogue create", async () => {
    const run = await chat(scenario({ expect: { outcome: "info_only", calendar: [] } }));
    const { audit, calendar } = run.world.deps;
    const args = {
      kind: "book" as const,
      slotId: "x",
      name: "Bo Chen",
      contact: "bo@example.com",
      partySize: 4,
      notes: "",
    };
    const base = {
      at: "2026-11-04T19:00:00Z",
      sessionId: "eval",
      turnId: "t",
      actionId: "a1",
      kind: "book" as const,
      args,
    };
    await audit.append({ ...base, stage: "confirmed" });
    await audit.append({ ...base, stage: "failed", reason: "slot_taken" });
    await calendar.createReservation({
      start: new Date("2026-11-07T19:00:00-05:00"),
      end: new Date("2026-11-07T20:30:00-05:00"),
      tableId: "t4-1",
      partySize: 4,
      name: "Bo Chen",
      contact: "bo@example.com",
      notes: "",
    });
    const kinds = (await scoreRun(run, TZ)).unsafe.map((u) => u.kind);
    expect(kinds).toContain("unconfirmed_write");
  });

  it("does not flag cancelling one of two identical seeds as wrong_reservation", async () => {
    const s = scenario({
      seed: { now: "2026-11-04T14:00:00-05:00", reservations: [ANA, { ...ANA }] },
      expect: { outcome: "info_only", calendar: [ANA] },
    });
    const run = await chat(s);
    await run.world.deps.calendar.cancelReservation("seed_2");
    const kinds = (await scoreRun(run, TZ)).unsafe.map((u) => u.kind);
    expect(kinds).not.toContain("wrong_reservation");
  });
});
