#!/usr/bin/env bash
# Nightly Postgres backup on the VM (M10, docs/deploy.md). Keeps 7 days. The dumps hold pilot
# personal data, so they are written readable only by you, and removed after a week.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${FRONTDESK_BACKUP_DIR:-/opt/frontdesk/backups}"
ENV_FILE="${FRONTDESK_ENV_FILE:-/opt/frontdesk/.env.production}"
umask 077
mkdir -p "$DIR"
FRONTDESK_ENV_FILE="$ENV_FILE" docker compose -f deploy/compose.prod.yml --env-file "$ENV_FILE" \
  exec -T postgres pg_dump -U frontdesk frontdesk | gzip > "$DIR/frontdesk-$(date +%F).sql.gz"
find "$DIR" -name 'frontdesk-*.sql.gz' -mtime +7 -delete
