import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, parse } from "dotenv";
import { buildDeps, REPO_ROOT } from "./deps.js";
import { buildServer } from "./server.js";

config({ path: resolve(REPO_ROOT, ".env"), quiet: true });
const defaults = parse(readFileSync(resolve(REPO_ROOT, ".env.example")));
// .env and the shell win; .env.example fills the gaps. Values are never printed.
const env = { ...defaults, ...process.env };

const built = await buildDeps(env);
const app = buildServer({
  chat: built.chat,
  webOrigins: (env.WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
});
await app.listen({ port: Number(env.API_PORT || 4000), host: "127.0.0.1" });
app.log.info(`front desk api ready (${built.summary})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => built.close())
      .then(() => process.exit(0));
  });
}
