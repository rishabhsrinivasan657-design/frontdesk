/** The business's timezone: a release is dated the way the restaurant would date it. */
const ZONE = "America/New_York";

/** `vYYYY.MM.DD` for today in New York, or `.2`, `.3`… when that tag already exists. */
export function nextTag(now: Date, existing: string[]): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, dateStyle: "short" })
    .format(now)
    .replaceAll("-", ".");
  const base = `v${day}`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}.${n}`)) n += 1;
  return `${base}.${n}`;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/;

/**
 * One CHANGELOG section from commit subjects (newest first, as `git log` lists them):
 * Features (`feat`), Fixes (`fix`), Other. Merge and release commits are left out.
 */
export function changelogSection(tag: string, date: string, subjects: string[]): string {
  const groups: Record<"Features" | "Fixes" | "Other", string[]> = {
    Features: [],
    Fixes: [],
    Other: [],
  };
  for (const subject of subjects) {
    if (subject.startsWith("Merge ") || subject.startsWith("chore(release)")) continue;
    const m = CONVENTIONAL.exec(subject);
    const [, type, scope, text] = m ?? [];
    const line = scope ? `- **${scope}:** ${text}` : `- ${text}`;
    if (type === "feat") groups.Features.push(line);
    else if (type === "fix") groups.Fixes.push(line);
    else groups.Other.push(`- ${subject}`);
  }
  const parts = [`## ${tag} (${date})`, ""];
  for (const [title, lines] of Object.entries(groups)) {
    if (lines.length === 0) continue;
    parts.push(`### ${title}`, "", ...lines, "");
  }
  return parts.join("\n");
}
