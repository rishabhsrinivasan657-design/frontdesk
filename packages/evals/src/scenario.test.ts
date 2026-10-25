import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ScenarioSchema, loadScenarios } from "./scenario.js";

const SPEC_EXAMPLE = `
id: reschedule-friday-to-saturday
category: reschedule
persona: "Busy parent, terse, existing booking under 'Ana Ruiz' Fri 7pm for 4"
goal: "Move it to Saturday around 7"
seed:
  now: 2026-11-04T14:00:00-05:00
  reservations: [{ name: Ana Ruiz, start: 2026-11-06T19:00, party: 4, contact: ana@example.com }]
expect:
  outcome: rescheduled
  calendar: [{ name: Ana Ruiz, start: 2026-11-07T19:00, party: 4 }]
`;

async function dirWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scenarios-"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

describe("ScenarioSchema", () => {
  it("parses the spec's example scenario", () => {
    const s = ScenarioSchema.parse(parse(SPEC_EXAMPLE));
    expect(s.category).toBe("reschedule");
    expect(s.seed.now).toBe("2026-11-04T14:00:00-05:00");
    expect(s.seed.reservations[0]).toMatchObject({ name: "Ana Ruiz", start: "2026-11-06T19:00" });
    expect(s.expect).toMatchObject({ outcome: "rescheduled", maxTurns: 8, handoffReason: null });
  });

  it.each([0, 61, 2.5])("rejects readbackPauseMinutes %s", (minutes) => {
    const doc = parse(SPEC_EXAMPLE) as { seed: Record<string, unknown> };
    doc.seed.readbackPauseMinutes = minutes;
    expect(ScenarioSchema.safeParse(doc).success).toBe(false);
  });

  it("accepts readbackPauseMinutes 6", () => {
    const doc = parse(SPEC_EXAMPLE) as { seed: Record<string, unknown> };
    doc.seed.readbackPauseMinutes = 6;
    expect(ScenarioSchema.parse(doc).seed.readbackPauseMinutes).toBe(6);
  });

  it("rejects an unknown key", () => {
    const doc = parse(SPEC_EXAMPLE) as { expect: Record<string, unknown> };
    doc.expect.outcom = "booked";
    expect(ScenarioSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    const doc = parse(SPEC_EXAMPLE) as Record<string, unknown>;
    doc.category = "smalltalk";
    expect(ScenarioSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an unknown handoff reason", () => {
    const doc = parse(SPEC_EXAMPLE) as { expect: Record<string, unknown> };
    doc.expect.handoffReason = "bored";
    expect(ScenarioSchema.safeParse(doc).success).toBe(false);
  });
});

describe("loadScenarios", () => {
  it("loads scenarios sorted by id", async () => {
    const other = SPEC_EXAMPLE.replace("reschedule-friday-to-saturday", "a-first");
    const dir = await dirWith({
      "reschedule-friday-to-saturday.yaml": SPEC_EXAMPLE,
      "a-first.yaml": other,
      "notes.txt": "ignored",
    });
    expect((await loadScenarios(dir)).map((s) => s.id)).toEqual([
      "a-first",
      "reschedule-friday-to-saturday",
    ]);
  });

  it("rejects an id that doesn't match the file name", async () => {
    const dir = await dirWith({ "wrong-name.yaml": SPEC_EXAMPLE });
    await expect(loadScenarios(dir)).rejects.toThrow(/wrong-name\.yaml/);
  });

  it("names the file on a schema error", async () => {
    const dir = await dirWith({ "broken.yaml": "id: broken\ncategory: booking\n" });
    await expect(loadScenarios(dir)).rejects.toThrow(/broken\.yaml/);
  });

  it("rejects duplicate ids", async () => {
    const dir = await dirWith({
      "reschedule-friday-to-saturday.yaml": SPEC_EXAMPLE,
      "reschedule-friday-to-saturday.yml": SPEC_EXAMPLE,
    });
    await expect(loadScenarios(dir)).rejects.toThrow(/duplicate/i);
  });
});
