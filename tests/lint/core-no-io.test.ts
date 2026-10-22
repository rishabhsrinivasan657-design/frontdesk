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

  it.each([
    ["dynamic import", `export const load = () => import("node:fs");\n`, "no-restricted-syntax"],
    ["unlisted built-in", `import os from "os";\nexport { os };\n`, "no-restricted-imports"],
    [
      "client subpath",
      `import { drizzle } from "drizzle-orm/node-postgres";\nexport { drizzle };\n`,
      "no-restricted-imports",
    ],
    ["re-export", `export { Client } from "pg";\n`, "no-restricted-imports"],
    [
      "fetch global",
      `export const get = () => fetch("https://x.test");\n`,
      "no-restricted-globals",
    ],
    ["process global", `export const secret = process.env.SECRET;\n`, "no-restricted-globals"],
  ])("rejects %s in packages/core", async (_label, code, rule) => {
    const ids = await lint(code, "packages/core/src/index.ts");
    expect(ids).toContain(rule);
  });

  it("allows node:fs outside core", async () => {
    const ids = await lint(`import fs from "node:fs";\nexport { fs };\n`, "apps/api/src/index.ts");
    expect(ids).not.toContain("no-restricted-imports");
  });
});
