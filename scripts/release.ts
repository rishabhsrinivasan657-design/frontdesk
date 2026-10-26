import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { changelogSection, nextTag } from "./release-lib.js";

/**
 * `pnpm release` (M10): tags `vYYYY.MM.DD` on main and prepends its CHANGELOG section, built
 * from the commits since the last tag. Commits and tags locally only: pushing is a separate step
 * you choose to take (docs/pilot.md).
 */
const root = resolve(import.meta.dirname, "..");
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const fail = (message: string): never => {
  console.error(`release: ${message}`);
  process.exit(1);
};

if (git("status", "--porcelain") !== "") fail("the working tree has changes; commit them first");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") fail(`releases are cut from main (you are on ${branch})`);

const tags = git("tag", "--list", "v*").split("\n").filter(Boolean);
let since: string;
try {
  since = git("describe", "--tags", "--abbrev=0", "--match", "v*");
} catch {
  since = git("rev-list", "--max-parents=0", "HEAD").split("\n")[0]!;
}
const subjects = git("log", `${since}..HEAD`, "--no-merges", "--format=%s")
  .split("\n")
  .filter(Boolean);
if (subjects.length === 0) fail(`nothing to release since ${since}`);

const now = new Date();
const tag = nextTag(now, tags);
const date = tag.slice(1, 11).replaceAll(".", "-");
const path = resolve(root, "CHANGELOG.md");
const header = "# Changelog\n\nWeekly releases of Front Desk (docs/pilot.md).\n";
const current = existsSync(path) ? readFileSync(path, "utf8") : header;
const body = current.startsWith(header) ? current.slice(header.length) : `\n${current}`;
writeFileSync(path, `${header}\n${changelogSection(tag, date, subjects)}${body}`);

git("add", "CHANGELOG.md");
git("commit", "-m", `chore(release): ${tag}`);
git("tag", "-a", tag, "-m", tag);
console.log(`Tagged ${tag} with ${subjects.length} commits since ${since}.`);
console.log(`Nothing was pushed. To publish it: git push origin main ${tag}`);
