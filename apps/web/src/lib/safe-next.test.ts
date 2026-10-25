import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each([
    [null, "/dashboard"],
    ["", "/dashboard"],
    ["https://evil.com/dashboard", "/dashboard"],
    ["//evil.com/dashboard", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["/talk", "/dashboard"],
    ["/dashboardx", "/dashboard"],
    ["/dashboard/../talk", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("rejects %j", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each(["/dashboard", "/dashboard/bookings?source=pilot", "/dashboard/conversations/sess_1"])(
    "keeps %s",
    (path) => {
      expect(safeNext(path)).toBe(path);
    },
  );
});
