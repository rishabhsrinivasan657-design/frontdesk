#!/usr/bin/env bash
# Deploys one release tag on the VM (M10, docs/deploy.md):  deploy/deploy.sh v2026.11.02
# Never prints the env file. Refuses to run if the env file is readable by anyone but you.
set -euo pipefail

TAG="${1:?usage: deploy/deploy.sh <tag, e.g. v2026.11.02>}"
ENV_FILE="${FRONTDESK_ENV_FILE:-/opt/frontdesk/.env.production}"
cd "$(dirname "$0")/.."

[ -f "$ENV_FILE" ] || { echo "deploy: $ENV_FILE is missing (docs/deploy.md, step 6)"; exit 1; }
mode="$(stat -c %a "$ENV_FILE")"
[ "$mode" = "600" ] || { echo "deploy: run 'chmod 600 $ENV_FILE' first (it is $mode)"; exit 1; }
SITE_HOST="$(grep -E '^SITE_HOST=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -n "$SITE_HOST" ] || { echo "deploy: SITE_HOST is empty in $ENV_FILE"; exit 1; }

git fetch --tags --quiet origin
git -c advice.detachedHead=false checkout --quiet "refs/tags/$TAG"
echo "deploy: building $TAG"

export FRONTDESK_ENV_FILE="$ENV_FILE"
compose() { docker compose -f deploy/compose.prod.yml --env-file "$ENV_FILE" "$@"; }
compose build --quiet
compose up -d --remove-orphans

echo "deploy: waiting for https://$SITE_HOST/health/ready"
for _ in $(seq 1 40); do
  if curl -fsS "https://$SITE_HOST/health/ready" > /dev/null 2>&1; then
    echo "deploy: $TAG is live. From your Mac, run: pnpm smoke https://$SITE_HOST"
    exit 0
  fi
  sleep 5
done
echo "deploy: not ready after 200 s. See: docker compose -f deploy/compose.prod.yml ps"
curl -sS "https://$SITE_HOST/health/ready" || true
echo
exit 1
