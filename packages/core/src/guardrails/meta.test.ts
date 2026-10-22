import { describe, expect, it } from "vitest";
import { parseMeta } from "./meta.js";

describe("parseMeta", () => {
  it("reads the meta line and returns the body without it", () => {
    expect(
      parseMeta('@meta {"confidence":0.82,"onTopic":false}\nI can only help with the restaurant.'),
    ).toEqual({
      confidence: 0.82,
      onTopic: false,
      body: "I can only help with the restaurant.",
      missing: false,
    });
  });

  it("treats a missing meta line as confident and on topic, and says so", () => {
    expect(parseMeta("Street parking only.")).toEqual({
      confidence: 1,
      onTopic: true,
      body: "Street parking only.",
      missing: true,
    });
  });

  it.each([
    '@meta {"confidence":2,"onTopic":true}\nHi.',
    "@meta not json\nHi.",
    '@meta {"confidence":0.9}\nHi.',
  ])("treats an invalid meta line as missing and never speaks it: %j", (draft) => {
    expect(parseMeta(draft)).toEqual({ confidence: 1, onTopic: true, body: "Hi.", missing: true });
  });
});
