import { resolve } from "node:path";
import { config } from "dotenv";
import { readGoogleEnv } from "./env.js";

/** Live tests read credentials from the repo's git-ignored .env; undefined means "skip". */
export function liveGoogleEnv() {
  config({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });
  return readGoogleEnv();
}
