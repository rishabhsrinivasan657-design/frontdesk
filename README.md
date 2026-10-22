# Front Desk

An AI receptionist for a small restaurant. It answers by voice or chat, checks availability, books, reschedules and cancels reservations in Google Calendar, sends confirmations, and hands off to a human when it's unsure. Every change needs the caller's explicit confirmation and is written to an append-only audit log.

The demo business is **Casa Fiorella**, a fictional family Italian trattoria. Design: [docs/superpowers/specs/2026-10-22-frontdesk-design.md](docs/superpowers/specs/2026-10-22-frontdesk-design.md).

## Prerequisites

- Node 24 (`.nvmrc`)
- pnpm 10, via `corepack enable`
- Docker (for Postgres and Redis)

## Quickstart

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # postgres on :54320, redis on :63790
pnpm verify        # lint, format check, typecheck, unit tests (no Docker needed)
pnpm test:infra    # smoke tests against the running containers
```

Host ports are non-standard on purpose so they don't clash with a local Postgres or Redis. Change `POSTGRES_PORT` / `REDIS_PORT` and the URLs in `.env` if you need different ones.

If `frontdesk_eval` is reported missing, your Postgres volume predates the init script. Recreate it with `docker compose down -v && pnpm infra:up` (this deletes local data).

## Workspace

| Path                    | Purpose                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/api`              | Fastify: WebSocket sessions, agent loop host, owner REST + live feed                                           |
| `apps/worker`           | BullMQ jobs: confirmation emails, retries, metric rollups                                                      |
| `packages/core`         | Pure domain: config, availability, agent loop, tools, confirmation gate, guardrails. No I/O (enforced by lint) |
| `packages/llm`          | LLM provider interface, providers, and cache / rate-limit / retry / spend-cap wrappers                         |
| `packages/integrations` | Google Calendar and Gmail adapters                                                                             |
| `packages/db`           | Drizzle schema and migrations                                                                                  |
| `packages/evals`        | Scenario simulator, scorer, `pnpm eval` scoreboard                                                             |

`apps/web` (Next.js caller widget and owner dashboard) arrives in milestone M6.
