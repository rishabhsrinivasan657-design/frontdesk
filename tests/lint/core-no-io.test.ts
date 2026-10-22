import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const lint = (code: string, filePath: string) =>
  eslint.lintText(code, { filePath }).then(([r]) => r!.messages.map((m) => m.ruleId));

describe("core purity rule", () => {
  it.each(["node:fs", "pg", "ioredis", "googleapis"])(
    "rejects %s in packages/core",
    async (mod) => {
      const ids = await lint(
        `import x from "${mod}";\nexport { x };\n`,
        "packages/core/src/index.ts",
      );
      expect(ids).toContain("no-restricted-imports");
    },
  );

  it("allows node:fs outside core", async () => {
    const ids = await lint(`import fs from "node:fs";\nexport { fs };\n`, "apps/api/src/index.ts");
    expect(ids).not.toContain("no-restricted-imports");
  });
});
