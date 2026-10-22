import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Spec §6: "There is no other code path to a write adapter." The gate's confirmAndExecute is
// the only production code allowed to touch a Calendar write method. Any mention of the name
// counts (calls, bracket access, destructuring), not just `.method(` calls.
const root = resolve(import.meta.dirname, "../..");
const ALLOWED = "packages/core/src/gate/execute.ts";
const WRITE_CALL = /\b(createReservation|moveReservation|cancelReservation)\b/;

/** Implementations and test code may define or exercise the methods directly. */
const EXEMPT = [
  /\.test\.ts$/,
  /^packages\/core\/src\/ports\/calendar\.ts$/,
  /^packages\/core\/src\/adapters\/memory\//,
  /^packages\/core\/src\/testing\//,
  /^packages\/integrations\/src\/.*calendar[^/]*\.ts$/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const files = ["apps", "packages"]
  .flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, group, d.name, "src")),
  )
  .flatMap((src) => {
    try {
      return sourceFiles(src);
    } catch {
      return [];
    }
  })
  .map((path) => relative(root, path).split("\\").join("/"));

describe("Calendar write path", () => {
  it("matches the write-call pattern it is meant to catch", () => {
    expect(WRITE_CALL.test("await calendar.createReservation(x)")).toBe(true);
    expect(WRITE_CALL.test("deps.calendar\n  .cancelReservation(id)")).toBe(true);
    expect(WRITE_CALL.test('calendar["moveReservation"](id, to)')).toBe(true);
    expect(WRITE_CALL.test("const { createReservation: c } = calendar")).toBe(true);
    expect(WRITE_CALL.test("listReservations(range)")).toBe(false);
  });

  it("scans the gate itself", () => {
    expect(files).toContain(ALLOWED);
    expect(WRITE_CALL.test(readFileSync(join(root, ALLOWED), "utf8"))).toBe(true);
  });

  it("finds Calendar write calls only in the gate", () => {
    const offenders = files.filter(
      (file) =>
        file !== ALLOWED &&
        !EXEMPT.some((re) => re.test(file)) &&
        WRITE_CALL.test(readFileSync(join(root, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
