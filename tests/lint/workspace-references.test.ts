import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// pnpm symlinks make tsc treat workspace imports as external libraries, so a
// missing project reference is invisible to `tsc -b`. This test enforces it.
const root = resolve(import.meta.dirname, "../..");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const packageDirs = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(group, d.name)),
);
const dirByName = new Map(
  packageDirs.map((dir) => [readJson(join(root, dir, "package.json")).name as string, dir]),
);

describe("workspace project references", () => {
  it.each(packageDirs)("%s references exactly its workspace dependencies", (dir) => {
    const pkg = readJson(join(root, dir, "package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    const expected = Object.entries(deps)
      .filter(([, version]) => version.startsWith("workspace:"))
      .map(([name]) => dirByName.get(name))
      .sort();

    const tsconfig = readJson(join(root, dir, "tsconfig.json"));
    const actual = ((tsconfig.references ?? []) as { path: string }[])
      .map((ref) => relative(root, resolve(root, dir, ref.path)))
      .sort();

    expect(actual).toEqual(expected);
  });

  it("root tsconfig references every package", () => {
    const refs = (readJson(join(root, "tsconfig.json")).references as { path: string }[]).map(
      (ref) => relative(root, resolve(root, ref.path)),
    );
    expect(refs.sort()).toEqual([...packageDirs].sort());
  });
});
