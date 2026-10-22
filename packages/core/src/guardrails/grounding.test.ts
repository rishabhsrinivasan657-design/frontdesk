import { describe, expect, it } from "vitest";
import { newSession } from "../agent/types.js";
import { testConfig } from "../config/test-config.js";
import { buildFacts, extractClaims, recordCallerValues, ungrounded } from "./grounding.js";

const NOW = new Date("2026-11-04T14:00:00-05:00");
const values = (text: string) => extractClaims(text).map((c) => `${c.kind}:${c.value}`);

describe("extractClaims", () => {
  it.each([
    ["7pm", ["time:19:00"]],
    ["7:00 PM", ["time:19:00"]],
    ["7 p.m.", ["time:19:00"]],
    ["at 19:00", ["time:19:00"]],
    ["12:30am", ["time:00:30"]],
    ["12 pm", ["time:12:00"]],
    ["noon", ["time:12:00"]],
    ["November 6", ["date:11-06"]],
    ["Nov 6th", ["date:11-06"]],
    ["2026-11-06", ["date:11-06"]],
    ["$22", ["price:22"]],
    ["$22.00", ["price:22"]],
    ["22 dollars", ["price:22"]],
    ["cancel up to 4 hours before", ["number:4 h"]],
    ["held 15 minutes", ["number:15 min"]],
    ["for 6 people", ["number:6 people"]],
    ["We have 2 options", []],
    ["Friday, November 6 at 7:00 PM", ["date:11-06", "time:19:00"]],
  ])("%j → %j", (text, expected) => {
    expect(values(text).sort()).toEqual([...expected].sort());
  });
});

describe("ungrounded", () => {
  const session = newSession("s1", NOW);
  session.offeredSlots["2026-11-06T19:00@t4-2#4"] = {
    id: "2026-11-06T19:00@t4-2#4",
    date: "2026-11-06",
    time: "19:00",
    start: "2026-11-06T19:00:00-05:00",
    end: "2026-11-06T20:30:00-05:00",
    tableId: "t4-2",
    tableSize: 4,
    partySize: 4,
  };
  const facts = buildFacts(testConfig(), session, NOW);
  const bad = (text: string) => ungrounded(text, facts).map((c) => c.raw);

  it("accepts values from tool results and config", () => {
    expect(bad("7pm on November 6 for 4 people works.")).toEqual([]);
    expect(bad("Cacio e pepe is $22.")).toEqual([]);
    expect(bad("You can cancel up to 4 hours before.")).toEqual([]);
    expect(bad("We open at 5 PM on Fridays and close at 11 PM.")).toEqual([]);
    expect(bad("We're closed on November 26.")).toEqual([]);
  });

  it("rejects values from nowhere", () => {
    expect(bad("We also have 7:30 PM.")).toEqual(["7:30 PM"]);
    expect(bad("It's $18.")).toEqual(["$18"]);
    expect(bad("Cancel up to 6 hours before.")).toEqual(["6 hours"]);
  });

  it("accepts dates and party sizes the caller stated, but not their times or prices", () => {
    const withCaller = newSession("s2", NOW);
    recordCallerValues(withCaller, "November 9, a table for 5, around 8:15pm, is it $40?");
    const facts = buildFacts(testConfig(), withCaller, NOW);
    expect(ungrounded("November 9 for 5 people", facts)).toEqual([]);
    expect(ungrounded("8:15 PM works and it's $40", facts).map((c) => c.raw)).toEqual([
      "8:15 PM",
      "$40",
    ]);
  });

  it("grounds the date, time and party size the agent asked check_availability about", () => {
    const asked = newSession("s4", NOW);
    asked.history.push({
      role: "assistant",
      text: "",
      toolCalls: [
        {
          id: "c1",
          name: "check_availability",
          args: { date: "2026-11-09", time: "19:30", partySize: 5 },
        },
      ],
    });
    expect(
      ungrounded(
        "7:30 PM on November 9 for 5 people is taken.",
        buildFacts(testConfig(), asked, NOW),
      ),
    ).toEqual([]);
  });

  it.each(["separate 2", "Market 5", "Decaf 2 please", "Marinara 3", "Junior 3"])(
    "does not read %j as a date",
    (text) => {
      expect(extractClaims(text)).toEqual([]);
    },
  );

  it("treats 1 day and 24 hours as the same duration", () => {
    const config = testConfig();
    config.policies.freeChangeUntilHoursBefore = 24;
    expect(
      ungrounded(
        "Changes are free until 1 day before.",
        buildFacts(config, newSession("s3", NOW), NOW),
      ),
    ).toEqual([]);
  });
});
