# Build from repo root: docker build -f docker/execution.Dockerfile .
#
# ⚠ DEPLOYMENT WARNING: this image is only the execution SERVICE. With
# EXECUTION_RUNNER=docker (the production default) the service spawns
# sibling containers, so the host running it must provide Docker daemon
# access (a dedicated, isolated Docker host or a mounted socket on a
# locked-down VM). Never run this on a shared web host, and never expose
# its port publicly — only the API may call it (x-internal-token).
# See docs/execution-security.md for the full model + verification checklist.
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
RUN pnpm --filter @collabcode/shared build && pnpm --filter @collabcode/execution build
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 4002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4002)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/execution/dist/server.js"]
