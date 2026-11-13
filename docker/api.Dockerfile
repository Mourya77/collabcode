# Build from repo root: docker build -f docker/api.Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/collaboration/package.json apps/collaboration/package.json
COPY apps/execution/package.json apps/execution/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile || pnpm install
FROM deps AS build
COPY . .
# prisma generate: the API's Prisma client is generated into node_modules
# and is NOT committed — typecheck/build/runtime all need it.
RUN pnpm --filter @collabcode/shared build && pnpm --filter @collabcode/api db:generate && pnpm --filter @collabcode/api build
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 4000
# Readiness (includes a DB check), not mere liveness: a container whose
# database is unreachable should not be treated as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Migrations are applied OUTSIDE the app process (the Render start command,
# a CI step, or a one-off job): `pnpm --filter @collabcode/api db:deploy`.
CMD ["node", "apps/api/dist/server.js"]
