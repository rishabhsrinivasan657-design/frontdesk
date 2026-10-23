import { describe, expect, it } from "vitest";
import { LLMConfigError, loadCatalog } from "./catalog.js";

describe("model catalog", () => {
  it("the shipped models.yaml loads", () => {
    const catalog = loadCatalog();
    expect(catalog.get("gemini-3.5-flash-lite")).toMatchObject({
      id: "gemini-3.5-flash-lite",
      provider: "gemini",
      freeTier: { rpm: 10, rpd: 500 },
      pricePerMTok: { input: 0.3, output: 2.5 },
    });
    expect(catalog.get("gemini-3.6-flash")?.freeTier).toEqual({ rpm: 5, rpd: 20 });
    expect(catalog.get("gemini-3.1-flash-lite")?.pricePerMTok).toEqual({
      input: 0.25,
      output: 1.5,
    });
  });

  it("rejects a negative rpm with LLMConfigError naming the path", () => {
    const yaml = `models:
  m1:
    provider: gemini
    freeTier: { rpm: -1, rpd: 5 }
    pricePerMTok: { input: 1, output: 1 }
    source: test
`;
    expect(() => loadCatalog(yaml)).toThrow(LLMConfigError);
    expect(() => loadCatalog(yaml)).toThrow(/models\.m1\.freeTier\.rpm/);
  });
});
