# syntax=docker/dockerfile:1
# The api and confirmation worker on Render's free tier (docs/deploy-render.md). It matches the
# `app` stage of the root Dockerfile, which the web service builds; Render can't pick a stage.

FROM node:24-bookworm-slim
RUN npm install -g pnpm@10.34.7
WORKDIR /app
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
ENV NODE_ENV=production
USER node
CMD ["bash", "deploy/render/start-api.sh"]
