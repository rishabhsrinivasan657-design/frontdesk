#!/usr/bin/env bash
# Render free tier (docs/deploy-render.md). Background workers aren't free on Render, so this one
# container runs the migrations, then the confirmation worker and the api side by side. If either
# stops, the container exits and Render restarts it. Values are never printed.
set -euo pipefail
cd /app

# One free Postgres holds both databases: the eval one sits beside the live one.
export EVAL_DATABASE_URL="${DATABASE_URL%/*}/frontdesk_eval"
export API_HOST=0.0.0.0
export API_PORT="${PORT:-10000}"

# `node --import tsx` runs each app as one process (the tsx CLI would add a second one per app),
# which matters on a 512 MB instance.
(cd packages/db && node --import tsx src/ensure-eval-db-cli.ts && node --import tsx src/migrate-cli.ts)

(cd apps/worker && exec node --import tsx src/main.ts) &
worker=$!
(cd apps/api && exec node --import tsx src/main.ts) &
api=$!

trap 'kill -TERM "$worker" "$api" 2>/dev/null || true' TERM INT
code=0
wait -n || code=$?
kill -TERM "$worker" "$api" 2>/dev/null || true
wait || true
exit "$code"
