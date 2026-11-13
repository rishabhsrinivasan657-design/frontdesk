import { describe, expect, it } from "vitest";
import { defaultSource, sourceParam, sourceQuery } from "./source";

describe("defaultSource", () => {
  it("is pilot only when the deploy says so", () => {
    expect(defaultSource("pilot")).toBe("pilot");
    expect(defaultSource("live")).toBe("live");
    expect(defaultSource(undefined)).toBe("live");
    expect(defaultSource("anything")).toBe("live");
  });
});

describe("sourceParam", () => {
  it("reads an explicit ?source= either way", () => {
    expect(sourceParam("pilot", "live")).toBe("pilot");
    expect(sourceParam("live", "pilot")).toBe("live");
  });

  it("falls back to the deploy's default when the link says nothing", () => {
    expect(sourceParam(undefined, "pilot")).toBe("pilot");
    expect(sourceParam(undefined, "live")).toBe("live");
    expect(sourceParam(["pilot", "live"], "live")).toBe("live");
  });
});

describe("sourceQuery", () => {
  it("adds nothing for the default, so plain links stay plain", () => {
    expect(sourceQuery("pilot", "pilot")).toBe("");
    expect(sourceQuery("live", "live")).toBe("");
  });

  it("names the other data set explicitly", () => {
    expect(sourceQuery("pilot", "live")).toBe("?source=pilot");
    expect(sourceQuery("live", "pilot")).toBe("?source=live");
  });
});
