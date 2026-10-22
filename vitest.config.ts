import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["{apps,packages}/*/src/**/*.test.ts", "tests/lint/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "infra",
          include: ["tests/infra/**/*.smoke.test.ts"],
          testTimeout: 15000,
        },
      },
    ],
  },
});
