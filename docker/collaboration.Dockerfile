# Build from repo root: docker build -f docker/collaboration.Dockerfile .
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
# The collaboration build generates its own Prisma client (build script).
RUN pnpm --filter @collabcode/shared build && pnpm --filter @collabcode/collaboration build
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
# 4001 = WebSocket + (single-port mode: /health + internal endpoints).
# 4003 = health port in dual-port (local) mode only.
EXPOSE 4001 4003
# Works in both modes: in production PORT is set ⇒ single-port ⇒ /health is
# on the WS port; locally the health server answers on 4003 — probe the WS
# port when PORT is set, else 4003.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||4003;const path=process.env.PORT?'/health':'/';fetch('http://127.0.0.1:'+p+path).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/collaboration/dist/server.js"]
