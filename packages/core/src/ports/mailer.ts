import type { ActionKind } from "../agent/types.js";
import type { Booking } from "./calendar.js";

export interface ConfirmationEmail {
  kind: ActionKind;
  to: string;
  booking: Booking;
  businessName: string;
  /** The session and action this email confirms, so each send attempt can be audited. */
  sessionId: string;
  actionId: string;
}

/** Confirmation emails are a side effect of a confirmed write, never a tool (spec §6). */
export interface Mailer {
  sendConfirmation(email: ConfirmationEmail): Promise<void>;
}
