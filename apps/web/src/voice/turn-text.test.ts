import { describe, expect, it } from "vitest";
import { turnCompleteness } from "./turn-text";

describe("turnCompleteness", () => {
  it.each([
    "yes",
    "Yes please.",
    "no thanks",
    "that's right",
    "correct",
    "thank you",
    "A table for 4 on Friday at 7pm",
    "My name is Ana Lopez",
    "cancel it",
  ])("%j sounds finished", (text) => {
    expect(turnCompleteness(text)).toBe("complete");
  });

  it.each([
    "a table for",
    "on Friday at",
    "for four and",
    "my name is",
    "um",
    "I'd like to book a table for uh",
    "at 7 or",
    "can I",
    "",
  ])("%j sounds unfinished", (text) => {
    expect(turnCompleteness(text)).toBe("incomplete");
  });

  it.each(["I was wondering about the menu", "Friday", "we are celebrating a birthday"])(
    "%j can't be told",
    (text) => {
      expect(turnCompleteness(text)).toBe("neutral");
    },
  );
});
