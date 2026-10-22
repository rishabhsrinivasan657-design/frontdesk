import { defineConfig } from "vitest/config";

const PACKAGE_SRC = "{apps,packages}/*/src/**";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [`${PACKAGE_SRC}/*.test.ts`, "tests/lint/**/*.test.ts"],
          // Redis smoke tests run in `infra`; live LLM tests run in `live`.
          exclude: ["**/node_modules/**", "**/*.smoke.test.ts", "**/*.live.test.ts"],
        },
      },
      {
        test: {
          name: "infra",
          include: ["tests/infra/**/*.smoke.test.ts", `${PACKAGE_SRC}/*.smoke.test.ts`],
          testTimeout: 15000,
        },
      },
      {
        test: {
          name: "live",
          include: [`${PACKAGE_SRC}/*.live.test.ts`],
          testTimeout: 30000,
        },
      },
    ],
  },
});
