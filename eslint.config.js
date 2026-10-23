import { builtinModules } from "node:module";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const CORE_PURITY_MESSAGE =
  "packages/core must stay pure: depend on an interface, not an I/O module (spec §3)";

const IO_CLIENTS = [
  "pg",
  "ioredis",
  "bullmq",
  "googleapis",
  "@google/genai",
  "drizzle-orm",
  "fastify",
];

/** Imports banned in packages/core: every Node built-in and I/O client, including subpaths. */
export const CORE_BANNED_IMPORTS = {
  patterns: ["node:*", ...builtinModules, ...IO_CLIENTS.map((name) => `${name}/*`)],
  paths: IO_CLIENTS,
};

/** Globals that reach the network or the host environment. */
const CORE_BANNED_GLOBALS = [
  "fetch",
  "process",
  "Buffer",
  "require",
  "XMLHttpRequest",
  "WebSocket",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist-types/**",
      "**/*.tsbuildinfo",
      "**/node_modules/**",
      "pnpm-lock.yaml",
      "**/.next/**",
      "**/next-env.d.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.ts", "packages/db/drizzle.config.ts", "apps/web/next.config.ts"],
        },
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
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: CORE_PURITY_MESSAGE },
      ],
      "no-restricted-globals": [
        "error",
        ...CORE_BANNED_GLOBALS.map((name) => ({ name, message: CORE_PURITY_MESSAGE })),
      ],
    },
  },
  eslintConfigPrettier,
);
