import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { BusinessConfigError, parseBusinessConfig } from "./parse.js";
import { testConfig } from "./test-config.js";

import type { BusinessConfig } from "./schema.js";

type Mutate = (config: BusinessConfig) => void;

function yamlWith(mutate: Mutate): string {
  const config = testConfig();
  mutate(config);
  return stringify(config);
}

function errorFor(text: string): BusinessConfigError {
  try {
    parseBusinessConfig(text);
  } catch (error) {
    if (error instanceof BusinessConfigError) return error;
    throw error;
  }
  throw new Error("expected parseBusinessConfig to throw");
}

describe("parseBusinessConfig", () => {
  it("parses a valid config", () => {
    expect(parseBusinessConfig(stringify(testConfig()))).toEqual(testConfig());
  });

  it("rejects YAML syntax errors", () => {
    expect(() => parseBusinessConfig("business: [unclosed")).toThrow(BusinessConfigError);
  });

  it.each<[string, Mutate, string]>([
    ["missing day", (c) => delete (c.hours as Partial<BusinessConfig["hours"]>).mon, "hours.mon"],
    ["invalid timezone", (c) => (c.business.timezone = "Mars/Olympus"), "business.timezone"],
    [
      "close not after open",
      (c) => (c.hours.tue = [{ open: "17:00", close: "17:00" }]),
      "hours.tue",
    ],
    [
      "overlapping intervals",
      (c) =>
        (c.hours.sun = [
          { open: "12:00", close: "15:00" },
          { open: "14:00", close: "21:00" },
        ]),
      "hours.sun",
    ],
    ["off-grid open", (c) => (c.hours.wed = [{ open: "17:10", close: "22:00" }]), "hours.wed"],
    ["close 24:00", (c) => (c.hours.thu = [{ open: "17:00", close: "24:00" }]), "hours.thu"],
    [
      "duplicate table size",
      (c) =>
        (c.seating.tables = [
          { size: 2, count: 8 },
          { size: 2, count: 1 },
        ]),
      "seating.tables",
    ],
    ["zero table count", (c) => (c.seating.tables[0]!.count = 0), "seating.tables"],
    ["private room min > max", (c) => (c.privateRoom.min = 40), "privateRoom"],
    ["invalid closure date", (c) => (c.closures[0]!.date = "2026-13-01"), "closures"],
    ["unknown handoff trigger", (c) => c.handoffTriggers.push("bored" as never), "handoffTriggers"],
    ["unknown top-level key", (c) => Object.assign(c, { extra: 1 }), "extra"],
  ])("rejects %s with a message naming %s", (_name, mutate, path) => {
    const error = errorFor(yamlWith(mutate));
    expect(error.message).toContain(path);
  });
});
