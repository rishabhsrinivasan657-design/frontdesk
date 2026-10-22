import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Spec §9: CI replays the eval subset with no API keys and fails on a regression.
const workflow = readFileSync(
  resolve(import.meta.dirname, "../../.github/workflows/ci.yml"),
  "utf8",
);

/** The text of one job under `jobs:` (2-space indent), up to the next job. */
function job(name: string): string | undefined {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("CI eval gate", () => {
  it("ci.yml has an evals job that runs pnpm eval:ci", () => {
    expect(job("evals")).toMatch(/run: pnpm eval:ci/);
  });

  it("the evals job uses no secrets or API keys", () => {
    const text = job("evals") ?? "";
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/GEMINI_API_KEY|OLLAMA/);
  });
});
