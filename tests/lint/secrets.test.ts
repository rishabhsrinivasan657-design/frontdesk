import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("secret hygiene", () => {
  it(".env is git-ignored", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", ".env"], { cwd: root })).not.toThrow();
  });

  it(".env.example leaves every secret empty", () => {
    const example = parse(readFileSync(resolve(root, ".env.example")));
    for (const key of ["GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GEMINI_API_KEY"]) {
      expect(example, key).toHaveProperty(key, "");
    }
  });
});
