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

  it("reads a meta line that shares a line with the reply", () => {
    expect(parseMeta('@meta {"confidence":0.4,"onTopic":true} We open at 5pm.')).toMatchObject({
      confidence: 0.4,
      body: "We open at 5pm.",
      missing: false,
    });
  });

  it.each([
    'Sure.\n@meta {"confidence":0.2,"onTopic":true}',
    '```\n@meta {"confidence":0.2,"onTopic":true}\n```\nSure.',
    '@META {"confidence":0.2,"onTopic":true}\nSure.',
  ])("finds a misplaced meta line, honors it and never speaks it: %j", (draft) => {
    const meta = parseMeta(draft);
    expect(meta.confidence).toBe(0.2);
    expect(meta.body).toBe("Sure.");
  });

  it.each([
    '@meta {"confidence":2,"onTopic":true}\nHi.',
    "@meta not json\nHi.",
    '@meta {"confidence":0.9}\nHi.',
  ])("treats an invalid meta line as missing and never speaks it: %j", (draft) => {
    expect(parseMeta(draft)).toEqual({ confidence: 1, onTopic: true, body: "Hi.", missing: true });
  });
});
