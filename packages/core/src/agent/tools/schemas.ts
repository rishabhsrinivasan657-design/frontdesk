import { z } from "zod";
import { DATE_PATTERN, HANDOFF_TRIGGERS, TIME_PATTERN } from "../../config/schema.js";
import type { ToolSpec } from "../../llm/types.js";

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(100);
const contact = z.string().trim().min(3).max(100);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]+$/;
/** A phone number (7–15 digits) or an email, so the read-back never says "contact Dev Shah". */
const bookingContact = contact.refine(
  (value) => EMAIL.test(value) || (PHONE.test(value) && /^(\D*\d){7,15}\D*$/.test(value)),
  "contact must be the caller's phone number or email; ask the caller for one",
);
const partySize = z.number().int().min(1).max(50);

/** Zod argument schemas for the allow-listed tools (spec §6). */
export const TOOL_ARGS = {
  check_availability: z.strictObject({
    date: z.string().regex(DATE_PATTERN).describe('Business-local date, "YYYY-MM-DD"'),
    time: z.string().regex(TIME_PATTERN).optional().describe('Business-local "HH:mm"'),
    partySize,
  }),
  find_reservation: z.strictObject({ name, contact }),
  lookup_faq: z.strictObject({ query: z.string().min(1).max(200) }),
  get_menu_item: z.strictObject({ name: z.string().min(1).max(100) }),
  book: z.strictObject({
    slotId: id.describe("A slotId returned by check_availability in this conversation"),
    name,
    contact: bookingContact.describe("Email or phone number"),
    partySize,
    notes: z.string().max(500).default("").describe("Allergies and requests, verbatim"),
  }),
  reschedule: z.strictObject({
    reservationId: id.describe("A reservationId returned by find_reservation"),
    slotId: id.describe("A slotId returned by check_availability"),
  }),
  cancel: z.strictObject({
    reservationId: id.describe("A reservationId returned by find_reservation"),
  }),
  request_handoff: z.strictObject({
    reason: z.enum(HANDOFF_TRIGGERS),
    summary: z.string().min(1).max(500),
  }),
};

export type ToolName = keyof typeof TOOL_ARGS;
export const WRITE_TOOLS = ["book", "reschedule", "cancel"] as const;
export type WriteToolName = (typeof WRITE_TOOLS)[number];

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOLS as readonly string[]).includes(name);
}

const DESCRIPTIONS: Record<ToolName, string> = {
  check_availability:
    "Find open tables for a party on a date, optionally near a time. Returns slotIds.",
  find_reservation:
    "Look up the caller's upcoming reservations by their name and contact (the email or phone number they gave). Ask for the contact first; never pass the name as the contact.",
  lookup_faq: "Search the restaurant's FAQ (parking, kids, dietary options, corkage, etc.).",
  get_menu_item:
    "Look up a menu item and its price by dish name, or list dishes by dietary tag (vegan, vegetarian, gluten-free).",
  book: "Propose a booking for an offered slot. The caller must confirm before it happens.",
  reschedule:
    "Propose moving a found reservation to an offered slot, which can also change its party size to the slot's. The caller must confirm first.",
  cancel: "Propose cancelling a found reservation. The caller must confirm first.",
  request_handoff: "Pass the conversation to a human with a short summary.",
};

export const TOOL_SPECS: ToolSpec[] = (Object.keys(TOOL_ARGS) as ToolName[]).map((tool) => ({
  name: tool,
  description: DESCRIPTIONS[tool],
  parameters: z.toJSONSchema(TOOL_ARGS[tool], { io: "input" }),
  effect: isWriteTool(tool) ? "write" : "read",
}));
