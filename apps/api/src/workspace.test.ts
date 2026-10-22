import { describe, expect, it } from "vitest";
import { CORE_PACKAGE } from "@frontdesk/core";

describe("workspace linking", () => {
  it("api resolves @frontdesk/core from source", () => {
    expect(CORE_PACKAGE).toBe("@frontdesk/core");
  });
});
