import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider, FsRecordingStore, withRecorder } from "@frontdesk/llm";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { parseArgs } from "./args.js";
import { loadConfig } from "./config.js";
import { type CliIO, main } from "./main.js";
import { buildProviders, writeManifest } from "./providers.js";
import { runScenario } from "./run.js";
import type { Scenario } from "./scenario.js";
import { bookingAgentSteps, bookingCallerSteps, scenario } from "./testing.js";

const config = loadConfig();

describe("parseArgs", () => {
  it("defaults to replay", () => {
    expect(parseArgs([])).toEqual({ mode: "replay", save: false, check: false });
  });
  it("reads every flag", () => {
    expect(
      parseArgs(["--record", "--filter", "faq", "--subset", "ci", "--save", "--check"]),
    ).toEqual({
      mode: "record",
      filter: "faq",
      subset: "ci",
      save: true,
      check: true,
    });
  });
  it.each([
    [["--live", "--record"], /choose one/],
    [["--filter", "smalltalk"], /--filter needs/],
    [["--filter"], /--filter needs/],
    [["--subset", "all"], /--subset supports/],
    [["--fast"], /unknown argument/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

/** A temp eval workspace: scenarios as YAML and recordings made by fake models. */
async function workspace(scenarios: Scenario[], record: Scenario[] = scenarios) {
  const root = await mkdtemp(join(tmpdir(), "evals-"));
  const scenariosDir = join(root, "scenarios");
  const recordingsDir = join(root, "recordings");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(scenariosDir);
  for (const s of scenarios) await writeFile(join(scenariosDir, `${s.id}.yaml`), stringify(s));
  const store = new FsRecordingStore(recordingsDir);
  for (const s of record) {
    await runScenario(s, {
      config,
      agent: withRecorder(new FakeProvider(bookingAgentSteps(), "fake-agent"), { store }),
      caller: withRecorder(new FakeProvider(bookingCallerSteps(), "fake-caller"), { store }),
    });
  }
  await writeManifest(recordingsDir, { agentModel: "fake-agent", callerModel: "fake-caller" });
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    env: {},
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    scenariosDir,
    recordingsDir,
    baselineFile: join(root, "baseline.json"),
    ciSubsetFile: join(root, "ci-subset.json"),
    now: () => new Date("2026-10-22T12:00:00Z"),
  };
  return { root, io, out, err };
}

describe("buildProviders", () => {
  it("replay does not need GEMINI_API_KEY", async () => {
    const { io } = await workspace([scenario()]);
    const p = await buildProviders("replay", {}, { recordingsDir: io.recordingsDir });
    expect(p).toMatchObject({ agentModel: "fake-agent", callerModel: "fake-caller" });
  });

  it("replay without a manifest says run --record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "empty-"));
    await expect(buildProviders("replay", {}, { recordingsDir: dir })).rejects.toThrow(
      /run pnpm eval --record/,
    );
  });

  it("live without GEMINI_API_KEY refuses to start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "empty-"));
    await expect(buildProviders("live", {}, { recordingsDir: dir })).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });
});

describe("main", () => {
  it("prints the scoreboard", async () => {
    const { io, out } = await workspace([scenario()]);
    expect(await main([], io)).toBe(0);
    expect(out.join("\n")).toMatch(/booking\s+1\s+100\.0%/);
  });

  it("prints the scoreboard when one scenario can't be replayed", async () => {
    const other = scenario({ id: "never-recorded", category: "faq", persona: "Someone else" });
    const { io, out } = await workspace([scenario(), other], [scenario()]);
    expect(await main([], io)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("booking");
    expect(text).toContain("never-recorded: missing");
  });

  it("--save refuses with --filter", async () => {
    const { io, err } = await workspace([scenario()]);
    expect(await main(["--save", "--filter", "booking"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/drop --filter/);
  });

  it("--save refuses when a scenario did not run cleanly", async () => {
    const { io, err } = await workspace(
      [scenario(), scenario({ id: "x", category: "faq", persona: "Someone else" })],
      [scenario()],
    );
    expect(await main(["--save"], io)).toBe(1);
    expect(err.join("\n")).toMatch(/not saving a baseline/);
  });

  it("saves a baseline, passes --check, and returns 1 on a drop", async () => {
    const { io, out } = await workspace([scenario()]);
    await writeFile(io.ciSubsetFile!, JSON.stringify(["book-saturday"]));
    expect(await main(["--subset", "ci", "--save"], io)).toBe(0);
    expect(await main(["--subset", "ci", "--check"], io)).toBe(0);
    expect(out.join("\n")).toContain("gate: pass");

    const baseline = JSON.parse(await readFile(io.baselineFile!, "utf8")) as { successPct: number };
    baseline.successPct = 103;
    await writeFile(io.baselineFile!, JSON.stringify(baseline));
    expect(await main(["--subset", "ci", "--check"], io)).toBe(1);
    expect(out.join("\n")).toContain("success dropped 3 points");
  });

  it("fails when no scenario matches", async () => {
    const { io, err } = await workspace([scenario()]);
    expect(await main(["--filter", "angry"], io)).toBe(1);
    expect(err.join("\n")).toMatch(/no scenarios match/);
  });

  it("rejects a subset that names an unknown scenario", async () => {
    const { io, err } = await workspace([scenario()]);
    await writeFile(io.ciSubsetFile!, JSON.stringify(["nope"]));
    expect(await main(["--subset", "ci"], io)).toBe(1);
    expect(err.join("\n")).toMatch(/unknown scenarios: nope/);
  });
});
