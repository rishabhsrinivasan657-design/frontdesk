# M0: Repo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up a pnpm TypeScript monorepo with lint, typecheck, unit tests, Postgres + Redis in Docker Compose, and a GitHub Actions CI. Every later milestone builds on top of it.

**Architecture:**
- **Packages:** the workspace packages are created as empty skeletons with project references between them. Internal packages export their TypeScript source directly (`exports → ./src/index.ts`), so there is no build step in dev or tests.
- **Typecheck:** `tsc -b` typechecks the whole reference graph.
- **Vitest projects:** one root Vitest config defines two projects. `unit` needs no Docker; `infra` contains smoke tests against Compose.
- **Core purity:** an ESLint rule enforces the spec's "core has no I/O" boundary from day one.

**Tech Stack:** Node 24, pnpm 10.34.7, TypeScript 5.x, Vitest (latest stable), ESLint 9 flat config + typescript-eslint, Prettier, Docker Compose (postgres:17, redis:7), GitHub Actions, `pg`, `ioredis`.

**Spec:** `docs/superpowers/specs/2026-10-22-frontdesk-design.md` (§3 Architecture, §13 Testing, §14 M0 row)

## Global Constraints

- Node `>=24` (`.nvmrc` = `24`), `packageManager: "pnpm@10.34.7"`, `.npmrc` has `engine-strict=true`.
- All packages are ESM (`"type": "module"`). Package names use the `@frontdesk/<dir>` scope.
- **TS settings:** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: "Bundler"`, `module: "ESNext"`, `target: "ES2023"`.
- **Workspaces in M0:** `apps/api`, `apps/worker`, `packages/core`, `packages/llm`, `packages/integrations`, `packages/db`, `packages/evals`. `apps/web` (Next.js) is **not** created in M0; it arrives in M6.
- **Core purity:** `packages/core` must not import Node I/O modules or I/O clients (spec §3: "No I/O, only interfaces").
- **Databases:** eval runs use a separate database from live/pilot (spec §10). Compose creates both `frontdesk` and `frontdesk_eval`.
- **Docker-free unit tests:** `pnpm test` must pass without Docker running. Docker-dependent tests live only in the `infra` project.
- Dependency versions are taken at install time and pinned by `pnpm-lock.yaml`, which is committed.
- Work on branch `m0-foundation`. Commit messages are conventional (`chore:`, `feat:`, `test:`, `ci:`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Local Postgres/Redis already on 5432/6379** (common on a Mac dev machine): host ports come from env (`POSTGRES_PORT`, `REDIS_PORT`), defaulting to 5432/6379. The smoke tests read their URLs from env. Test in Task 4.
2. **Infra smoke tests run with Compose down:** they should fail within ~5 s with a message that says `docker compose up -d`, not hang. Test in Task 4.
3. **Existing Postgres volume from before the eval DB existed:** init scripts only run on an empty volume, so `frontdesk_eval` would be missing. The smoke test must name the missing DB and say `docker compose down -v`. Test in Task 4.
4. **A package imports another without a project reference:** `tsc -b` must catch it. The api → core import is exercised in Task 2 so the reference graph is proven, not assumed.
5. **Someone runs `pnpm test` without Docker:** it must pass, because `unit` excludes `tests/infra/**`. Verified in Task 4, Step 6.

---

### Task 1: Workspace root and package skeletons

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `.gitignore`, `.editorconfig`, `tsconfig.base.json`, `tsconfig.json`
- Create, for each of `apps/api`, `apps/worker`, `packages/{core,llm,integrations,db,evals}`: `package.json`, `tsconfig.json`, `src/index.ts`

**Interfaces:**
- Produces:
  - Root scripts: `typecheck` (`tsc -b`), `test`, `test:infra`, `lint`, `format`, `verify`. Only `typecheck` is functional after this task; the others are wired in later tasks.
  - Each package has `exports: { ".": "./src/index.ts" }`.
  - Each package `tsconfig.json` extends `../../tsconfig.base.json` with `composite: true`, `emitDeclarationOnly: true`, `outDir: "dist-types"`, `rootDir: "src"`, and `references` to the workspace packages it depends on.

- [ ] **Step 1: Create branch**

Run: `git checkout -b m0-foundation`
Expected: `Switched to a new branch 'm0-foundation'`

- [ ] **Step 2: Write root files**

`pnpm-workspace.yaml` lists `apps/*` and `packages/*`. `.gitignore` covers `node_modules`, `dist-types`, `*.tsbuildinfo`, `.env`, `coverage`, `playwright-report`. The root `tsconfig.json` has `"files": []` and references all seven packages.

- [ ] **Step 3: Write the seven package skeletons**

Each `src/index.ts` is `export {};` except `packages/core`, whose export is defined in Task 2. Dependency edges in M0: `apps/api` depends on `@frontdesk/core` (`"workspace:*"`) and references it. No other edges yet.

- [ ] **Step 4: Install and typecheck**

Run: `pnpm install && pnpm typecheck`
Expected: install completes, `pnpm-lock.yaml` is created, and `tsc -b` exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace and package skeletons"
```

---

### Task 2: Vitest projects and the cross-package test

**Files:**
- Create: `vitest.config.ts`
- Modify: `packages/core/src/index.ts`, `package.json` (scripts)
- Test: `apps/api/src/workspace.test.ts`

**Interfaces:**
- Consumes: package skeletons from Task 1.
- Produces:
  - `export const CORE_PACKAGE = "@frontdesk/core" as const;` in `@frontdesk/core`. This is a placeholder that M1 replaces with real exports.
  - Vitest projects: `unit` (include `{apps,packages}/*/src/**/*.test.ts` and `tests/lint/**/*.test.ts`) and `infra` (include `tests/infra/**/*.smoke.test.ts`, `testTimeout: 15000`).
  - Scripts: `test` = `vitest run --project unit`, `test:infra` = `vitest run --project infra`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/workspace.test.ts
import { describe, expect, it } from "vitest";
import { CORE_PACKAGE } from "@frontdesk/core";

describe("workspace linking", () => {
  it("api resolves @frontdesk/core from source", () => {
    expect(CORE_PACKAGE).toBe("@frontdesk/core");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test`
Expected: FAIL. Either vitest is not installed yet, or the test fails because `CORE_PACKAGE` is not exported.

- [ ] **Step 3: Add `vitest` (root devDependency), `vitest.config.ts` with the two projects above, the `test`/`test:infra` scripts, and the `CORE_PACKAGE` export**

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: `1 passed` in project `unit`; `tsc -b` exits 0.

- [ ] **Step 5: Prove the reference graph is enforced**

Temporarily remove the `references` entry for core from `apps/api/tsconfig.json`, then run `pnpm typecheck`.
Expected: a TS error in `apps/api/src/workspace.test.ts` (TS6305/TS6307, or the file is not listed within the project). Restore the reference and confirm `pnpm typecheck` exits 0 again. If removing the reference does **not** produce an error, set `"include": ["src"]` in each package tsconfig so the test file is part of the project, and repeat.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add vitest unit/infra projects and workspace linking test"
```

---

### Task 3: ESLint, Prettier, and the core-purity rule

**Files:**
- Create: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`
- Modify: `package.json` (scripts `lint` = `eslint . --max-warnings 0`, `format` = `prettier --write .`, `format:check` = `prettier --check .`)
- Test: `tests/lint/core-no-io.test.ts`

**Interfaces:**
- Produces: a flat config with `typescript-eslint` `recommendedTypeChecked` (using `parserOptions.projectService: true`) for `**/*.ts`, plus a `packages/core/**` block that uses `no-restricted-imports`. The banned list is exported from the config as `CORE_BANNED_IMPORTS` so the test can assert on it.
- **Banned in core:** patterns `node:*`, `fs`, `net`, `http`, `https`, `child_process`, plus the packages `pg`, `ioredis`, `bullmq`, `googleapis`, `@google/genai`, `drizzle-orm`, `fastify`. The message is `"packages/core must stay pure: depend on an interface, not an I/O module (spec §3)"`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lint/core-no-io.test.ts
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const lint = (code: string, filePath: string) =>
  eslint.lintText(code, { filePath }).then(([r]) => r!.messages.map((m) => m.ruleId));

describe("core purity rule", () => {
  it.each(["node:fs", "pg", "ioredis", "googleapis"])("rejects %s in packages/core", async (mod) => {
    const ids = await lint(`import x from "${mod}";\nexport { x };\n`, "packages/core/src/index.ts");
    expect(ids).toContain("no-restricted-imports");
  });

  it("allows node:fs outside core", async () => {
    const ids = await lint(`import fs from "node:fs";\nexport { fs };\n`, "apps/api/src/index.ts");
    expect(ids).not.toContain("no-restricted-imports");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/lint`
Expected: FAIL. Either eslint is not installed, or `no-restricted-imports` is absent from the results.

- [ ] **Step 3: Install `eslint`, `typescript-eslint`, `prettier`, and `eslint-config-prettier`, then write the configs above**

Ignore `**/dist-types/**`, `**/*.tsbuildinfo`, and `pnpm-lock.yaml`.

- [ ] **Step 4: Run the tests, lint, and format check**

Run: `pnpm test && pnpm lint && pnpm format:check`
Expected: all unit tests pass (workspace + 5 lint cases); lint exits 0 with no warnings; Prettier reports all files formatted. Run `pnpm format` once first if needed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add eslint/prettier with core purity rule"
```

---

### Task 4: Docker Compose (Postgres + Redis) and infra smoke tests

**Files:**
- Create: `docker-compose.yml`, `docker/postgres/init/01-create-eval-db.sql`, `.env.example`
- Create: `tests/infra/env.ts`, `tests/infra/postgres.smoke.test.ts`, `tests/infra/redis.smoke.test.ts`
- Modify: root `package.json` (devDependencies `pg`, `@types/pg`, `ioredis`, `dotenv`; scripts `infra:up` = `docker compose up -d --wait`, `infra:down` = `docker compose down`)

**Interfaces:**
- Produces, for M2/M5 to reuse:
  - Env var names `DATABASE_URL`, `EVAL_DATABASE_URL`, `REDIS_URL`, `POSTGRES_PORT`, `REDIS_PORT`.
  - Compose services named `postgres` and `redis`.
  - `tests/infra/env.ts` exports `infraEnv(): { databaseUrl: string; evalDatabaseUrl: string; redisUrl: string }`. It loads `.env` if present and falls back to the `.env.example` defaults.
- **Compose details:**
  - `postgres:17-alpine`, user/password/db `frontdesk`/`frontdesk`/`frontdesk`, port `${POSTGRES_PORT:-5432}:5432`, a named volume, init dir mounted at `/docker-entrypoint-initdb.d`, healthcheck `pg_isready -U frontdesk`.
  - `redis:7-alpine`, port `${REDIS_PORT:-6379}:6379`, healthcheck `redis-cli ping`.
- **`.env.example`:**
  - `DATABASE_URL=postgres://frontdesk:frontdesk@localhost:5432/frontdesk`
  - `EVAL_DATABASE_URL=postgres://frontdesk:frontdesk@localhost:5432/frontdesk_eval`
  - `REDIS_URL=redis://localhost:6379`
  - `POSTGRES_PORT=5432`
  - `REDIS_PORT=6379`

- [ ] **Step 1: Write the failing smoke tests**

```ts
// tests/infra/postgres.smoke.test.ts
import pg from "pg";
import { describe, expect, it } from "vitest";
import { infraEnv } from "./env";

const UP_HINT = "Is Postgres running? Try: pnpm infra:up (docker compose up -d)";

async function query(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`${UP_HINT}\n${(e as Error).message}`);
  }
  try { return await client.query(sql); } finally { await client.end(); }
}

describe("postgres", () => {
  it("live database answers", async () => {
    const r = await query(infraEnv().databaseUrl, "select 1 as ok");
    expect(r.rows[0].ok).toBe(1);
  });

  it("separate eval database exists", async () => {
    const r = await query(infraEnv().databaseUrl,
      "select 1 from pg_database where datname = 'frontdesk_eval'");
    expect(r.rowCount, "frontdesk_eval missing: your volume predates the init script. Run: docker compose down -v && pnpm infra:up").toBe(1);
  });

  it("fails fast with an actionable message when nothing is listening", async () => {
    const started = Date.now();
    await expect(query("postgres://x:x@localhost:1/x", "select 1")).rejects.toThrow(/docker compose up -d/);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
```

`tests/infra/redis.smoke.test.ts` follows the same pattern. Use `new Redis(url, { connectTimeout: 3000, maxRetriesPerRequest: 1, lazyConnect: true })`, `await connect()`, and assert `ping()` resolves to `"PONG"`. Include the same fast-fail case against `redis://localhost:1`, rejecting within 5000 ms with a message that matches `/docker compose up -d/`. Always `disconnect()` in `finally`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:infra`
Expected: FAIL. `pg`/`ioredis` are not installed, or (once installed) the connection is refused and the error contains `docker compose up -d`.

- [ ] **Step 3: Write `docker-compose.yml`, the init SQL (`CREATE DATABASE frontdesk_eval;`), `.env.example`, and `tests/infra/env.ts`; install the devDependencies**

- [ ] **Step 4: Start infra and run the smoke tests**

Run: `pnpm infra:up && pnpm test:infra`
Expected: both containers report healthy; `6 passed` (3 Postgres, 3 Redis).

- [ ] **Step 5: Check the custom-port path**

Run: `pnpm infra:down && POSTGRES_PORT=55432 REDIS_PORT=56379 pnpm infra:up && DATABASE_URL=postgres://frontdesk:frontdesk@localhost:55432/frontdesk REDIS_URL=redis://localhost:56379 pnpm test:infra`
Expected: `6 passed`. Then run `pnpm infra:down && pnpm infra:up` to restore the defaults.

- [ ] **Step 6: Confirm unit tests don't need Docker**

Run: `pnpm infra:down && pnpm test`
Expected: unit tests pass, and no file under `tests/infra` is collected.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add postgres/redis compose with separate eval db and smoke tests"
```

---

### Task 5: `pnpm verify` and GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: `package.json` (script `verify` = `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`)

**Interfaces:**
- Consumes: the scripts from Tasks 1–4.
- **Produces:** the workflow `ci`, triggered on `push` to `main` and on `pull_request`, with two jobs:
  - `checks`: checkout, `pnpm/action-setup` (version from `packageManager`), `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm verify`.
  - `infra`: the same setup, plus `services:` `postgres:17-alpine` (env user/password/db `frontdesk`, port 5432, health options) and `redis:7-alpine` (port 6379). A step runs `psql "$DATABASE_URL" -c "CREATE DATABASE frontdesk_eval"`, because service containers can't mount the init dir. Then `pnpm test:infra` runs with the three URLs from `.env.example` as job env.
  - M4 adds the eval replay job to this workflow.

- [ ] **Step 1: Write the workflow and `verify` script**

- [ ] **Step 2: Lint the workflow**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: no output, exit 0.

- [ ] **Step 3: Run the full local equivalent**

Run: `pnpm verify && pnpm infra:up && pnpm test:infra`
Expected: every step exits 0.

- [ ] **Step 4: Write `README.md`**

Cover: the project one-liner from spec §1, prerequisites (Node 24, pnpm via `corepack enable`, Docker), quickstart (`pnpm install`, `cp .env.example .env`, `pnpm infra:up`, `pnpm verify`, `pnpm test:infra`), the workspace map from spec §3, and a link to the spec.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: add verify script and github actions for checks and infra"
```

- [ ] **Step 6: Hand off for finishing**

M0's "done when" (spec §14) is that `pnpm test` and `pnpm lint` pass in CI and Compose starts Postgres and Redis. CI can only run once the repo has a GitHub remote. Use superpowers:finishing-a-development-branch. If no remote exists, ask the user to create the GitHub repo (or approve `gh repo create`), then push `m0-foundation` and open the PR. Confirm both CI jobs are green before calling M0 done.
