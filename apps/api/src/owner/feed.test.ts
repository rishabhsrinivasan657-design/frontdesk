import { describe, expect, it } from "vitest";
import { type LiveEvent, OwnerFeed } from "./feed.js";

const open: LiveEvent = { type: "session_open", sessionId: "s1", at: "2026-11-04T19:00:00.000Z" };

describe("OwnerFeed", () => {
  it("delivers to every subscriber until it unsubscribes", () => {
    const feed = new OwnerFeed();
    const a: LiveEvent[] = [];
    const b: LiveEvent[] = [];
    const offA = feed.subscribe((e) => a.push(e));
    feed.subscribe((e) => b.push(e));
    feed.publish(open);
    offA();
    feed.publish(open);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it("a throwing subscriber doesn't stop delivery", () => {
    const feed = new OwnerFeed();
    const got: LiveEvent[] = [];
    feed.subscribe(() => {
      throw new Error("boom");
    });
    feed.subscribe((e) => got.push(e));
    expect(() => feed.publish(open)).not.toThrow();
    expect(got).toEqual([open]);
  });
});
