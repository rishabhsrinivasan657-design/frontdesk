import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalog } from "@frontdesk/llm";
import { type CliOptions, parseArgs } from "./args.js";
import { loadConfig } from "./config.js";
import { type Baseline, type Targets, checkGate, checkTargets, toBaseline } from "./gate.js";
import {
  BASELINE_FILE,
  CI_SUBSET_FILE,
  RECORDINGS_DIR,
  SCENARIOS_DIR,
  TARGETS_FILE,
} from "./paths.js";
import { type ProviderDeps, buildProviders } from "./providers.js";
import { buildReport, formatScoreboard } from "./report.js";
import { runScenario } from "./run.js";
import { type Scenario, loadScenarios } from "./scenario.js";
import { type ScenarioScore, scoreRun } from "./score.js";

export interface CliIO extends ProviderDeps {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  scenariosDir?: string;
  baselineFile?: string;
  ciSubsetFile?: string;
  targetsFile?: string;
  now?: () => Date;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function select(options: CliOptions, io: CliIO): Promise<Scenario[]> {
  const all = await loadScenarios(io.scenariosDir ?? SCENARIOS_DIR);
  let scenarios = all;
  if (options.subset) {
    const file = io.ciSubsetFile ?? CI_SUBSET_FILE;
    const ids = await readJson<string[]>(file);
    if (!ids) throw new Error(`no subset file at ${file}`);
    const unknown = ids.filter((id) => !all.some((s) => s.id === id));
    if (unknown.length > 0)
      throw new Error(`subset names unknown scenarios: ${unknown.join(", ")}`);
    scenarios = scenarios.filter((s) => ids.includes(s.id));
  }
  if (options.filter) scenarios = scenarios.filter((s) => s.category === options.filter);
  if (options.only) {
    const unknown = options.only.find((id) => !all.some((s) => s.id === id));
    if (unknown) throw new Error(`unknown scenario id "${unknown}"`);
    scenarios = scenarios.filter((s) => options.only!.includes(s.id));
  }
  return scenarios;
}

/** `pnpm eval`: runs scenarios, prints the scoreboard, optionally saves or checks the baseline. */
export async function main(argv: string[], io: CliIO): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr((error as Error).message);
    return 2;
  }
  if (options.save && options.filter) {
    io.stderr("--save needs the whole set: drop --filter");
    return 2;
  }
  if (options.targets && (options.subset || options.filter || options.only)) {
    io.stderr("--targets needs the whole suite: drop --subset, --filter and --only");
    return 2;
  }
  if (options.save && options.only) {
    io.stderr("--save needs the whole subset, not --only");
    return 2;
  }

  const recordingsDir = io.recordingsDir ?? RECORDINGS_DIR;
  const runsDir = join(recordingsDir, "_runs");
  let scenarios: Scenario[];
  let providers: Awaited<ReturnType<typeof buildProviders>>;
  try {
    providers = await buildProviders(options.mode, io.env, { ...io, recordingsDir });
    scenarios = await select(options, io);
    if (scenarios.length === 0) throw new Error("no scenarios match the options");
  } catch (error) {
    io.stderr((error as Error).message);
    return 1;
  }

  const config = loadConfig();
  const tz = config.business.timezone;
  const scores: ScenarioScore[] = [];
  for (const scenario of scenarios) {
    const run = await runScenario(scenario, {
      config,
      agent: providers.agent,
      caller: providers.caller,
    });
    const score = await scoreRun(run, tz);
    const runFile = join(runsDir, `${scenario.id}.json`);
    if (options.mode === "record" && run.status === "ok") {
      await mkdir(runsDir, { recursive: true });
      await writeFile(runFile, `${JSON.stringify({ latencyMs: run.latencyMs.map(Math.round) })}\n`);
    } else if (options.mode === "replay") {
      // Replayed calls take ~0 ms; report the latency measured when the run was recorded.
      const recorded = await readJson<{ latencyMs: number[] }>(runFile);
      if (recorded) score.latencyMs = recorded.latencyMs;
    }
    io.stderr(
      `${scenario.id}: ${score.status}${score.status === "ok" ? (score.success ? " ✓" : " ✗") : ""}${run.error ? ` (${run.error})` : ""}`,
    );
    if (options.verbose) {
      io.stderr(run.transcript.map((line) => `  ${line.role}: ${line.text}`).join("\n"));
    }
    scores.push(score);
  }

  const report = buildReport(scores, {
    mode: options.mode,
    subset: options.subset,
    agentModel: providers.agentModel,
    price: loadCatalog().get(providers.agentModel)?.pricePerMTok,
  });
  io.stdout(formatScoreboard(report));

  const quota = scores.filter((s) => s.status === "quota");
  if (quota.length > 0) {
    const categories = [...new Set(quota.map((s) => s.category))].join(", ");
    io.stderr(`quota exhausted: re-run tomorrow with --filter <category> for: ${categories}`);
  }

  let code = report.unsafeActions > 0 ? 1 : 0;
  const baselineFile = io.baselineFile ?? BASELINE_FILE;
  if (options.save) {
    if (report.statuses.ok !== report.n || report.unsafeActions > 0) {
      io.stderr("not saving a baseline: every scenario must run cleanly with 0 unsafe actions");
      return 1;
    }
    const baseline = toBaseline(report, io.now?.() ?? new Date());
    await writeFile(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`);
    io.stdout(`baseline saved to ${baselineFile}`);
  }
  if (options.check) {
    const gate = checkGate(report, await readJson<Baseline>(baselineFile));
    if (gate.ok) io.stdout("gate: pass");
    else {
      io.stdout(`gate: FAIL\n${gate.failures.map((f) => `  - ${f}`).join("\n")}`);
      code = 1;
    }
  }
  if (options.targets) {
    const file = io.targetsFile ?? TARGETS_FILE;
    const targets = await readJson<Targets>(file);
    const failures = targets ? checkTargets(report, targets) : [`no targets file at ${file}`];
    const unclean = report.n - report.statuses.ok;
    if (unclean > 0) failures.push(`${unclean} scenario(s) did not run cleanly`);
    if (failures.length === 0) io.stdout("targets: pass");
    else {
      io.stdout(`targets: FAIL\n${failures.map((f) => `  - ${f}`).join("\n")}`);
      code = 1;
    }
  }
  return code;
}
