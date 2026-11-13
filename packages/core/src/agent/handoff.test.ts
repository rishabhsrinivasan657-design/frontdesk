import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { propose } from "../gate/propose.js";
import { agentFixture, ANA } from "../testing/agent-fixtures.js";
import { handOff, handoffDetails } from "./handoff.js";

const book = (slotId: string) => ({
  slotId,
  name: "Bo Chen",
  contact: "bo@example.com",
  partySize: 4,
  notes: "",
});

describe("handoffDetails: what the owner's card shows, from the session (never the model)", () => {
  it("is empty when the guest asked for nothing concrete", () => {
    const fx = agentFixture(testConfig(), []);
    expect(handoffDetails(fx.session, testConfig())).toEqual({});
  });

  it("takes the date and party from the last availability check, but not a time", async () => {
    const fx = agentFixture(testConfig(), []);
    await fx.offer("2026-11-07", "19:00", 4);
    // A check returns nearby alternatives too, so no single time is "the" request.
    expect(handoffDetails(fx.session, testConfig())).toEqual({
      date: "Saturday, November 7",
      partySize: 4,
    });
  });

  it("a voided booking gives the whole request: who, when, how many", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-07", "19:00", 4);
    const proposed = await propose(fx.deps, fx.session, "turn_1", "book", book(slotId));
    if (!proposed.ok) throw new Error(proposed.message);
    expect(handoffDetails(fx.session, testConfig(), proposed.action)).toEqual({
      name: "Bo Chen",
      contact: "bo@example.com",
      date: "Saturday, November 7",
      time: "7:00 PM",
      partySize: 4,
    });
  });

  it("a reservation the guest looked up gives their name, contact and booking", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    expect(handoffDetails(fx.session, testConfig())).toEqual({
      name: ANA.name,
      contact: ANA.contact,
      date: "Friday, November 6",
      time: "7:00 PM",
      partySize: 4,
    });
  });

  it("finds an email or phone number the guest typed, when nothing else names them", () => {
    const fx = agentFixture(testConfig(), []);
    fx.session.transcript.push(
      { role: "caller", text: "I need to talk to someone", turnId: "t1" },
      { role: "agent", text: "Sure, how can we reach you?", turnId: "t1" },
      { role: "caller", text: "call me on (555) 014-2277 please", turnId: "t2" },
    );
    expect(handoffDetails(fx.session, testConfig())).toEqual({ contact: "(555) 014-2277" });
    fx.session.transcript.push({ role: "caller", text: "or dan@example.com", turnId: "t3" });
    expect(handoffDetails(fx.session, testConfig())).toEqual({ contact: "dan@example.com" });
  });

  it("handOff puts the details on the ticket", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-07", "19:00", 4);
    await propose(fx.deps, fx.session, "turn_1", "book", book(slotId));
    await handOff(fx.deps, fx.session, "turn_2", "human_requested", () => {});
    const [ticket] = fx.deps.handoffs.tickets;
    expect(ticket?.details).toMatchObject({ name: "Bo Chen", time: "7:00 PM", partySize: 4 });
  });
});
