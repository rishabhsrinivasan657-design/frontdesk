import { describe, expect, it } from "vitest";
import type { ConfirmationEmail, Mailer } from "../ports/mailer.js";

const booking = {
  id: "res_contract",
  start: new Date("2026-11-08T00:00:00.000Z"),
  end: new Date("2026-11-08T01:30:00.000Z"),
  tableId: "t4-1",
  partySize: 4,
  name: "Ana Ruiz",
  notes: "",
};

/** Shared behavior every Mailer must have (in-memory and Gmail). `to` is where sends go. */
export function runMailerContract(
  name: string,
  make: () => { mailer: Mailer; to: string },
  opts: { skip?: boolean } = {},
): void {
  describe.skipIf(opts.skip ?? false)(`${name} Mailer contract`, () => {
    const email = (kind: ConfirmationEmail["kind"], to: string): ConfirmationEmail => ({
      kind,
      to,
      businessName: "Casa Fiorella (demo)",
      sessionId: "s_contract",
      actionId: `act_contract_${kind}`,
      booking: { ...booking, contact: to },
    });

    it("sends a booking confirmation", async () => {
      const { mailer, to } = make();
      await expect(mailer.sendConfirmation(email("book", to))).resolves.toBeUndefined();
    });

    it("sends a cancellation", async () => {
      const { mailer, to } = make();
      await expect(mailer.sendConfirmation(email("cancel", to))).resolves.toBeUndefined();
    });
  });
}
