import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { main } from "./main.js";
import { EVALS_DIR } from "./paths.js";

loadEnv({ path: resolve(EVALS_DIR, "../../.env"), quiet: true });
process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});
