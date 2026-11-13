# Deployment runbook (Phase 8)

CollabCode deploys as three pieces plus a database. **Code execution is
disabled in the hosted deployment** — see "Execution policy" below; it is a
deliberate safety rule, not a missing feature.

| Piece | Host | Source |
|---|---|---|
| Web (React SPA) | Vercel | `apps/web` + `apps/web/vercel.json` |
| API (Express) | Render web service `collabcode-api` | `render.yaml` |
| Collaboration (Hocuspocus WS) | Render web service `collabcode-collab` | `render.yaml` |
| PostgreSQL | Render Postgres `collabcode-db` (or Neon) | `render.yaml` |
| Execution | **Not deployed** (disabled) | — |

## Execution policy (read first)

The public deployment runs **without a code-execution backend**: the API's
`EXECUTION_SERVICE_URL` is left unset, so `POST /api/projects/:id/executions`
returns `503 {"code":"EXECUTION_DISABLED"}` and creates no record, and the
web Output panel shows a calm "execution is not enabled on this deployment"
notice. Rationale (Phase 8 spec rule): *untrusted code execution is never
deployed on an ordinary shared web service without verified isolation.* The
DockerRunner path is implemented and unit-tested but has never been
live-verified (no Docker host was available during development), so execution
stays off until the checklist in
[docs/execution-security.md](execution-security.md#docker-host-verification-checklist)
has been run end-to-end on a dedicated, isolated Docker host. Only then:
deploy `apps/execution` there, set `EXECUTION_SERVICE_URL` on the API, and
redeploy the API.

## Render (API + collaboration + database)

1. Push the repo to GitHub, then in Render: **New → Blueprint**, select the
   repo. Render reads `render.yaml` and proposes `collabcode-db`,
   `collabcode-api`, `collabcode-collab`. Create them.
2. **First pass — dashboard-set secrets** (marked `sync: false` in
   `render.yaml`; the services will not be fully functional until pass 2):
   - On **both** services, set `COLLAB_INTERNAL_TOKEN` to the **same** random
     value (≥32 chars). It guards the collab restore endpoint; if the two
     values differ, version restore fails with 502 — by design.
   - `JWT_SECRET` on **both** services: use the **same** value on both (the
     API signs collab tokens; the collab server verifies them).
     `EXECUTION_INTERNAL_TOKEN` on the API is Render-generated
     (`generateValue: true`); it is only used if execution is ever enabled,
     but a real value is required even while disabled because the API rejects
     the development default in production.
3. Note the two service URLs (e.g. `https://collabcode-api.onrender.com`,
   `https://collabcode-collab.onrender.com`) and the Vercel URL once the web
   app is deployed (below).
4. **Second pass — cross-service wiring** (this is why the values are
   `sync: false`: they are only knowable after the first deploy):
   - API: `CORS_ORIGINS` = the Vercel origin (comma-separated if several),
     `APP_BASE_URL` = the Vercel origin (used in invitation email links).
   - Collab: `ALLOWED_ORIGINS` = the Vercel origin.
   - Redeploy both services (env changes trigger a deploy on Render).
5. **Health checks.** API: `GET /api/health` (liveness, bare `HealthStatus`),
   `GET /api/health/ready` (readiness — pings the DB; this is the
   `healthCheckPath` in `render.yaml`). Collab: `GET /health` returns
   `{ status, service: "collaboration", pendingStores }`.
6. **Migrations** run automatically: the API start command is
   `prisma migrate deploy && node dist/server.js`.

### Collaboration single-port mode

Render exposes exactly **one** port per web service. Locally the collab
server listens on 4001 (WS) + 4003 (health); in production it runs in
**single-port mode** (derived automatically when `NODE_ENV=production` and
the platform injects `PORT`; `SINGLE_PORT=true/false` overrides): the
WebSocket server and `GET /health` (plus the token-guarded internal restore
endpoint) share the platform port. `render.yaml` sets
`healthCheckPath: /health` accordingly. Details:
[docs/collaboration.md](collaboration.md#single-port-mode-phase-8).

### Free-tier caveats (know before you demo)

- **Render free Postgres expires ~30 days after creation** and is then
  deleted. For anything longer-lived, create a free **Neon** Postgres
  instead and set `DATABASE_URL` on both services manually (delete the
  `fromDatabase` link or just override the env var). Data migration between
  the two is a `pg_dump`/`pg_restore` exercise; the schema itself is
  re-applied by `prisma migrate deploy`.
- **Free web services spin down after ~15 minutes idle**; the first request
  after that takes ~30–60 s (cold start). The API, collab and web all
  exhibit this on free plans — warm the demo links before showing them.
- The Vercel free tier has no spin-down for static assets.

## Vercel (web)

1. Import the repo in Vercel, set the **root directory to `apps/web`**.
   `apps/web/vercel.json` already declares: framework `vite`,
   `installCommand: pnpm install --frozen-lockfile`,
   `buildCommand: pnpm --filter @collabcode/shared build && pnpm build`
   (the web app consumes `@collabcode/shared` from its `dist`, so shared is
   built first), `outputDirectory: dist`, an SPA rewrite to `/index.html`,
   and the Phase 7 security headers (CSP, HSTS, frame/referrer/permissions
   policies).
2. Environment variables (Production):
   - `VITE_API_URL` = the API origin, e.g. `https://collabcode-api.onrender.com`
     (no trailing slash; the client appends `/api/...`).
   - `VITE_COLLAB_URL` = the collab **WebSocket** origin, e.g.
     `wss://collabcode-collab.onrender.com`.
   `VITE_*` values are baked into the bundle at build time — after changing
   them, redeploy the web app.
3. Copy the resulting Vercel origin back into the Render pass-2 env vars
   above.

## Environment variables

[`.env.production.example`](../.env.production.example) at the repo root
documents **every** production variable per service (purpose, where it is
set, whether it is secret). Highlights:

- Secrets are only ever set in the host dashboards — never committed, never
  `VITE_`-prefixed (the web bundle is public).
- Production guards fail fast at boot: development JWT secrets, the dev
  internal tokens and the dev database password are all rejected when
  `NODE_ENV=production` (API, collab and execution each enforce this).

## Rollback

- **Code:** Render → service → **Deploys** → pick the previous deploy →
  **Rollback**. Vercel → Deployments → previous deployment → **Promote to
  Production**. Both are instant and do not touch the database.
- **Database:** migrations are forward-only (no `down` migrations are
  authored). A bad migration is fixed by a new corrective migration, not by
  rolling back; take a `pg_dump` before any deploy that adds a migration if
  the data matters.
- **Config:** env-var mistakes are the most common failure — re-check the
  pass-2 wiring (matching `JWT_SECRET`/`COLLAB_INTERNAL_TOKEN` pairs,
  CORS/allowed origins equal to the exact Vercel origin, `wss://` scheme on
  `VITE_COLLAB_URL`) before rolling back code.

## Local production-shaped runs

- `docker compose up` builds all four services from `docker/*.Dockerfile`
  (reviewed structurally; **the Compose path has not been live-run where no
  Docker binary exists** — see docs/testing.md). The execution container
  carries a warning: it must run on an isolated Docker host, and in Compose
  it starts with the subprocess runner explicitly for local development.
- Without Docker: `pnpm install && pnpm build`, then run each service's
  `start` script with a production `.env` — the same fail-fast guards apply.
