# syntax=docker/dockerfile:1
# Front Desk production images (M10, docs/deploy.md). Built on the VM itself (arm64), because
# the web build bakes in the public site's NEXT_PUBLIC_* values.

FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@10.34.7
WORKDIR /app
# Manifests first, so dependency installs are cached until a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/evals/package.json packages/evals/
COPY packages/integrations/package.json packages/integrations/
COPY packages/llm/package.json packages/llm/
RUN pnpm install --frozen-lockfile
COPY . .

# api, worker and migrate run TypeScript through tsx; compose picks the command.
FROM base AS app
ENV NODE_ENV=production
USER node

FROM base AS web
ARG NEXT_PUBLIC_API_WS_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_PRIVACY_CONTACT
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_WS_URL=$NEXT_PUBLIC_API_WS_URL \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_PRIVACY_CONTACT=$NEXT_PUBLIC_PRIVACY_CONTACT
RUN pnpm --filter @frontdesk/web build && chown -R node:node apps/web/.next
USER node
CMD ["pnpm", "--filter", "@frontdesk/web", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
