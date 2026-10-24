import type { NextConfig } from "next";

const config: NextConfig = {
  // tsconfig.json is a composite project for `tsc -b`; Next edits and checks this one.
  typescript: { tsconfigPath: "tsconfig.next.json" },
  // Next would otherwise guess the monorepo root from the lockfile and warn.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
};

export default config;
