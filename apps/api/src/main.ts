import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, parse } from "dotenv";
import { buildDeps, REPO_ROOT } from "./deps.js";
import { buildServer } from "./server.js";

config({ path: resolve(REPO_ROOT, ".env"), quiet: true });
const defaults = parse(readFileSync(resolve(REPO_ROOT, ".env.example")));
// .env and the shell win; .env.example fills the gaps. Values are never printed.
const env = { ...defaults, ...process.env };

function list(value: string): string[] {
  return value
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

const built = await buildDeps(env);
const app = buildServer({
  chat: built.chat,
  ...(built.owner ? { owner: built.owner } : {}),
  ownerRoutes: built.ownerRoutes,
  ...(built.chatGuard ? { chatGuard: built.chatGuard } : {}),
  ...(built.botCheck ? { botCheck: built.botCheck } : {}),
  webOrigins: list(env.WEB_ORIGINS ?? ""),
  trustProxy: list(env.TRUST_PROXY ?? "127.0.0.1,::1"),
});
// 0.0.0.0 only inside a container, where Caddy is the one door in (docs/deploy.md).
await app.listen({ port: Number(env.API_PORT || 4000), host: env.API_HOST || "127.0.0.1" });
app.log.info(`front desk api ready (${built.summary})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => built.close())
      .then(() => process.exit(0));
  });
}
