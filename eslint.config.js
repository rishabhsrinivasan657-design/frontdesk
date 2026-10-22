import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const CORE_PURITY_MESSAGE =
  "packages/core must stay pure: depend on an interface, not an I/O module (spec §3)";

/** Imports banned in packages/core: Node built-ins and I/O clients. */
export const CORE_BANNED_IMPORTS = {
  patterns: ["node:*", "fs", "fs/*", "net", "http", "https", "child_process"],
  paths: ["pg", "ioredis", "bullmq", "googleapis", "@google/genai", "drizzle-orm", "fastify"],
};

export default tseslint.config(
  { ignores: ["**/dist-types/**", "**/*.tsbuildinfo", "**/node_modules/**", "pnpm-lock.yaml"] },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: CORE_BANNED_IMPORTS.paths.map((name) => ({ name, message: CORE_PURITY_MESSAGE })),
          patterns: [{ group: CORE_BANNED_IMPORTS.patterns, message: CORE_PURITY_MESSAGE }],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
