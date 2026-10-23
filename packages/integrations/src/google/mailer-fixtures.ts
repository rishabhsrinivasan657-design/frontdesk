import type { ConfirmationEmail } from "@frontdesk/core";

export const email: ConfirmationEmail = {
  kind: "book",
  to: "ana@example.com",
  businessName: "Casa Fiorella",
  sessionId: "s1",
  actionId: "act_1",
  booking: {
    id: "res_1",
    start: new Date("2026-11-08T00:00:00.000Z"),
    end: new Date("2026-11-08T01:30:00.000Z"),
    tableId: "t4-1",
    partySize: 4,
    name: "Ana Ruiz",
    contact: "ana@example.com",
    notes: "",
  },
};
