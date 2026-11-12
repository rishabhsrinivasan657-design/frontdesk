import { describe, expect, it } from "vitest";
import { orbState } from "./orb-state";

describe("orbState: the orb only shows what is really happening", () => {
  it("is idle with nothing going on", () => {
    expect(orbState({ voice: "idle", speaking: false, busy: false })).toBe("idle");
  });

  it("listens while the microphone is open, even over a reply (barge-in)", () => {
    expect(orbState({ voice: "listening", speaking: true, busy: true })).toBe("listening");
  });

  it("speaks while a reply is read aloud, after the text has finished streaming too", () => {
    expect(orbState({ voice: "idle", speaking: true, busy: false })).toBe("speaking");
    expect(orbState({ voice: "idle", speaking: true, busy: true })).toBe("speaking");
  });

  it("thinks while a turn runs and nothing is being said", () => {
    expect(orbState({ voice: "idle", speaking: false, busy: true })).toBe("thinking");
  });

  it("is unavailable when voice can't work in this browser", () => {
    for (const voice of ["unsupported", "denied", "error"] as const) {
      expect(orbState({ voice, speaking: false, busy: false })).toBe("unavailable");
    }
    expect(orbState({ voice: "unsupported", speaking: false, busy: true })).toBe("thinking");
  });
});
