#!/usr/bin/env bash
# Deploys one release tag on the VM (M10, docs/deploy.md):  deploy/deploy.sh v2026.11.02
# Never prints the env file. Refuses to run if the env file is readable by anyone but you.
set -euo pipefail

TAG="${1:?usage: deploy/deploy.sh <tag, e.g. v2026.11.02>}"
ENV_FILE="${FRONTDESK_ENV_FILE:-/opt/frontdesk/.env.production}"
cd "$(dirname "$0")/.."

[ -f "$ENV_FILE" ] || { echo "deploy: $ENV_FILE is missing (docs/deploy.md, step 6)"; exit 1; }
# GNU stat on the VM; BSD stat on a Mac (the tests).
mode="$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE")"
[ "$mode" = "600" ] || { echo "deploy: run 'chmod 600 $ENV_FILE' first (it is $mode)"; exit 1; }
value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
SITE_HOST="$(value SITE_HOST)"
[ -n "$SITE_HOST" ] || { echo "deploy: SITE_HOST is empty in $ENV_FILE"; exit 1; }
# Without quotes Compose reads the hash's $ signs as variables, and the owner can never log in.
grep -qE '^OWNER_PASSWORD_HASH='"'"'[$]2[aby][$]' "$ENV_FILE" || {
  echo "deploy: put OWNER_PASSWORD_HASH in single quotes: OWNER_PASSWORD_HASH='\$2b\$12\$...'"
  exit 1
}
# The site key is baked into the web build; without it every chat fails the bot check.
[ -n "$(value NEXT_PUBLIC_TURNSTILE_SITE_KEY)" ] || {
  echo "deploy: NEXT_PUBLIC_TURNSTILE_SITE_KEY is empty (docs/deploy.md, step 4)"
  exit 1
}
[ -z "${FRONTDESK_PREFLIGHT_ONLY:-}" ] || { echo "deploy: preflight ok"; exit 0; }

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
