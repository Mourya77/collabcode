# Build from repo root: docker build -f docker/web.Dockerfile .
# Container alternative — the production frontend target is Vercel
# (apps/web/vercel.json); this image exists for self-hosting the SPA.
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/collaboration/package.json apps/collaboration/package.json
COPY apps/execution/package.json apps/execution/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm --filter @collabcode/shared build && pnpm --filter @collabcode/web build
# Unprivileged nginx: the whole process runs as a non-root user (port 8080).
FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
