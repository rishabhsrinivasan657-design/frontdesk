import { describe, expect, it } from "vitest";
import { createKeyTag, readKeyTag } from "./key-tag.js";

describe("createKeyTag", () => {
  it("is keyed: the same value tags differently under another secret", () => {
    expect(createKeyTag("a")("555-0100")).not.toBe(createKeyTag("b")("555-0100"));
    expect(createKeyTag("a")("555-0100")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("reads KEY_HASH_SECRET, with a fixed dev secret when unset", () => {
    expect(readKeyTag({ KEY_HASH_SECRET: "s" })("x")).toBe(createKeyTag("s")("x"));
    expect(readKeyTag({})("x")).toBe(createKeyTag("dev")("x"));
  });
});
