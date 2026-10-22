import { describe, expect, it } from "vitest";
import { TOOL_SPECS } from "./schemas.js";

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
