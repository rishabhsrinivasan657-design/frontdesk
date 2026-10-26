import { describe, expect, it } from "vitest";
import { quotaKey } from "./quota-key.js";

describe("quotaKey", () => {
  it("one inbox is one key: case, spaces and +tags", () => {
    expect(quotaKey(" Ana+1@Example.com ")).toBe("ana@example.com");
    expect(quotaKey("ana+promo@example.com")).toBe("ana@example.com");
  });

  it("Gmail ignores dots and treats googlemail as gmail", () => {
    expect(quotaKey("a.n.a@gmail.com")).toBe("ana@gmail.com");
    expect(quotaKey("Ana.R+x@googlemail.com")).toBe("anar@gmail.com");
  });

  it("other domains keep their dots", () => {
    expect(quotaKey("a.na@example.com")).toBe("a.na@example.com");
  });

  it("a US number with or without +1 is one key", () => {
    expect(quotaKey("+1 (555) 010-0199")).toBe("5550100199");
    expect(quotaKey("555.010.0199")).toBe("5550100199");
  });
});
