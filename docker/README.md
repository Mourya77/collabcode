Dockerfiles for all services live here (chosen over per-app files so the monorepo build context — repo root — is explicit). All images are multi-stage with small Alpine bases; every service runs as a non-root user (the `node` user for Node services, the unprivileged nginx image for web) and defines a HEALTHCHECK against the service's real health endpoint. Dependency layers are cached by copying all workspace manifests before any source.

Notes:

- `api.Dockerfile` runs `prisma generate` in the build stage (the generated client is not committed) and its healthcheck uses the DB-aware readiness endpoint `/api/health/ready`. Database migrations are applied outside the app container (`pnpm --filter @collabcode/api db:deploy`).
- `collaboration.Dockerfile` healthcheck probes `/health` on `$PORT` when set (single-port mode) and the health port otherwise.
- `execution.Dockerfile` carries a prominent warning: the service needs a Docker daemon on an isolated host to spawn job containers — see `docs/execution-security.md`. It is not part of the default public deployment.
- `web.Dockerfile` is the self-hosting alternative (the production target is Vercel, `apps/web/vercel.json`); `nginx.conf` provides the SPA fallback and the same security headers as the Vercel config.
- The runtime stage copies the built workspace (including dev dependencies) rather than pruning — simpler and reliable for a portfolio deployment; image size is traded for build robustness.
- These Dockerfiles are structurally reviewed but were NOT built in the authoring sandbox (no Docker binary there). Build them on any Docker host: `docker build -f docker/api.Dockerfile .` etc.
