import { describe, expect, it } from "vitest";
import { TOOL_ARGS, TOOL_SPECS } from "./schemas.js";

describe("TOOL_SPECS", () => {
  it("lists exactly the eight tools, with write effect only on book/reschedule/cancel", () => {
    expect(Object.fromEntries(TOOL_SPECS.map((t) => [t.name, t.effect]))).toEqual({
      check_availability: "read",
      find_reservation: "read",
      lookup_faq: "read",
      get_menu_item: "read",
      book: "write",
      reschedule: "write",
      cancel: "write",
      request_handoff: "read",
    });
  });

  it("gives every tool a JSON Schema object for its parameters", () => {
    for (const tool of TOOL_SPECS) {
      expect(tool.parameters).toMatchObject({ type: "object" });
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

describe("book contact", () => {
  const book = (contact: string) =>
    TOOL_ARGS.book.safeParse({ slotId: "s1", name: "Dev Shah", contact, partySize: 2 }).success;

  it.each(["dev@example.com", "555-123-4567", "07700 900123", "+1 (555) 123-4567"])(
    "accepts the phone number or email %j",
    (contact) => expect(book(contact)).toBe(true),
  );

  it.each(["Dev Shah", "Dev", "dev at example dot com", "call me", "123", "555-CALL-NOW"])(
    "rejects %j, which is neither a phone number nor an email",
    (contact) => expect(book(contact)).toBe(false),
  );
});
