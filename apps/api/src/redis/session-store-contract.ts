import {
  type Booking,
  type PendingAction,
  type SessionState,
  type SessionStore,
  newSession,
} from "@frontdesk/core";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-11-04T14:00:00-05:00");

const ANA: Booking = {
  id: "res_ana",
  start: new Date("2026-11-06T19:00:00-05:00"),
  end: new Date("2026-11-06T20:30:00-05:00"),
  tableId: "t4-1",
  partySize: 4,
  name: "Ana Ruiz",
  contact: "ana@example.com",
  notes: "",
};

let n = 0;
export const uniqueId = (prefix: string) => `${prefix}_${Date.now()}_${++n}`;

function session(id: string): SessionState {
  const s = newSession(id, NOW);
  s.turn = 2;
  s.knownReservations[ANA.id] = ANA;
  s.offeredSlots["slot"] = {
    id: "slot",
    date: "2026-11-07",
    time: "19:00",
    start: "2026-11-07T19:00:00-05:00",
    end: "2026-11-07T20:30:00-05:00",
    tableId: "t4-1",
    tableSize: 4,
    partySize: 4,
  };
  return s;
}

export function pendingFor(
  sessionId: string,
  id = "act_1",
  expiresAt = "2026-11-04T14:05:00-05:00",
): PendingAction {
  return {
    id,
    sessionId,
    args: { kind: "cancel", reservationId: ANA.id },
    summary: "To confirm: cancel…",
    reservation: ANA,
    proposedTurn: 2,
    expiresAt,
  };
}

/** What any SessionStore must do; runs against the in-memory and Redis stores. */
export function runSessionStoreContract(name: string, make: () => Promise<SessionStore>): void {
  describe(`SessionStore contract: ${name}`, () => {
    it("returns undefined for an unknown session", async () => {
      const store = await make();
      expect(await store.load(uniqueId("sess"))).toBeUndefined();
    });

    it("save then load returns an equal copy", async () => {
      const store = await make();
      const s = session(uniqueId("sess"));
      await store.save(s);
      expect(await store.load(s.id)).toEqual(s);
    });

    it("round-trips Dates in session and pending action", async () => {
      const store = await make();
      const s = session(uniqueId("sess"));
      await store.save(s);
      await store.putPending(pendingFor(s.id));
      const loaded = await store.load(s.id);
      expect(loaded?.knownReservations[ANA.id]?.start).toBeInstanceOf(Date);
      expect(loaded?.knownReservations[ANA.id]?.start.getTime()).toBe(ANA.start.getTime());
      const pending = await store.getPending(s.id);
      expect(pending?.reservation?.end).toBeInstanceOf(Date);
      expect(pending).toEqual(pendingFor(s.id));
    });

    it("putPending replaces the existing one", async () => {
      const store = await make();
      const id = uniqueId("sess");
      await store.putPending(pendingFor(id, "act_1"));
      await store.putPending(pendingFor(id, "act_2"));
      expect((await store.getPending(id))?.id).toBe("act_2");
    });

    it("takePending with the wrong id leaves it in place", async () => {
      const store = await make();
      const id = uniqueId("sess");
      await store.putPending(pendingFor(id, "act_1"));
      expect(await store.takePending(id, "act_other")).toBeUndefined();
      expect((await store.getPending(id))?.id).toBe("act_1");
    });

    it("takePending twice returns it once", async () => {
      const store = await make();
      const id = uniqueId("sess");
      await store.putPending(pendingFor(id, "act_1"));
      expect((await store.takePending(id, "act_1"))?.id).toBe("act_1");
      expect(await store.takePending(id, "act_1")).toBeUndefined();
    });

    it("clearPending returns and removes it", async () => {
      const store = await make();
      const id = uniqueId("sess");
      await store.putPending(pendingFor(id, "act_1"));
      expect((await store.clearPending(id))?.id).toBe("act_1");
      expect(await store.getPending(id)).toBeUndefined();
    });
  });
}
