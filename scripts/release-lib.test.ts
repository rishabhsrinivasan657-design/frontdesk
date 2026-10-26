import { describe, expect, it } from "vitest";
import { changelogSection, nextTag } from "./release-lib.js";

describe("nextTag", () => {
  it("tags in New York date", () => {
    expect(nextTag(new Date("2026-10-27T02:00:00Z"), [])).toBe("v2026.10.26");
    expect(nextTag(new Date("2026-10-27T05:00:00Z"), [])).toBe("v2026.10.27");
  });

  it("second release same day gets .2, then .3", () => {
    const at = new Date("2026-11-02T15:00:00Z");
    expect(nextTag(at, ["v2026.11.02"])).toBe("v2026.11.02.2");
    expect(nextTag(at, ["v2026.11.02", "v2026.11.02.2", "v2026.10.26"])).toBe("v2026.11.02.3");
  });
});

describe("changelogSection", () => {
  it("groups feat/fix/other, keeps scopes, drops merges and release commits", () => {
    const section = changelogSection("v2026.11.02", "2026-11-02", [
      "feat(api): per-IP chat limits",
      "fix: retention skips seeded rows",
      "Merge pull request #24 from x/y",
      "chore(release): v2026.10.26",
      "docs: deploy runbook",
      "feat: privacy page",
    ]);
    expect(section).toBe(
      [
        "## v2026.11.02 (2026-11-02)",
        "",
        "### Features",
        "",
        "- **api:** per-IP chat limits",
        "- privacy page",
        "",
        "### Fixes",
        "",
        "- retention skips seeded rows",
        "",
        "### Other",
        "",
        "- docs: deploy runbook",
        "",
      ].join("\n"),
    );
  });

  it("omits empty groups", () => {
    expect(changelogSection("v1", "2026-11-02", ["fix: one"])).toBe(
      "## v1 (2026-11-02)\n\n### Fixes\n\n- one\n",
    );
  });
});
