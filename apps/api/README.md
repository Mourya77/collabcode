# @collabcode/api

Express + TypeScript REST API (port 4000). Phase 2: full auth, users, projects,
members, files and versions API. Phase 4: invitations v2, the chat WebSocket
gateway (`/api/chat/ws`, same port) and workspace presence. Phase 5: code
executions — the API validates, persists and proxies runs to the internal
execution service (see `../../docs/execution.md`) — full reference in
`../../docs/api.md` and at `/api/docs` (Swagger UI) / `/api/openapi.json`
when the server is running.

## Run

```bash
pnpm --filter @collabcode/api dev        # tsx watch, http://localhost:4000
pnpm --filter @collabcode/api build      # tsc → dist/
pnpm --filter @collabcode/api start      # node dist/server.js
pnpm --filter @collabcode/api test       # vitest (unit + integration)
```

## Environment (validated with Zod at boot — the server fails fast with a clear message)

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://collabcode:collabcode_dev_password@localhost:5432/collabcode?schema=public` | docker-compose credentials |
| `JWT_SECRET` | built-in dev value | **Must be ≥ 32 chars; the built-in default is rejected when `NODE_ENV=production`** |
| `ACCESS_TOKEN_TTL_MIN` | `15` | Access JWT lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh token lifetime |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowlist (credentials enabled) |
| `COOKIE_SECURE` | `false` (`true` in production) | Secure flag on cookies |
| `GLOBAL_RATE_LIMIT` / `AUTH_RATE_LIMIT` | `300` / `20` per 15 min | Effectively disabled under `NODE_ENV=test` |
| `PORT` | `4000` | REST + chat WebSocket gateway share this port |
| `APP_BASE_URL` | `http://localhost:5173` | Base URL for invitation links (`<APP_BASE_URL>/invite/<token>`) — Phase 4 |
| `INVITATION_TTL_DAYS` | `7` | Invitation lifetime before lazy expiry — Phase 4 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | unset | Mailer: unset `SMTP_HOST` = DevMailer (logs the invite link; the create response returns it). Production: set all five, or wire a provider (Resend/SES) behind the `Mailer` interface — see `../../docs/api.md` |
| `EXECUTION_SERVICE_URL` | `http://localhost:4002` | Internal execution service base URL — Phase 5 |
| `EXECUTION_INTERNAL_TOKEN` | dev default | Shared secret with the execution service; the dev default is rejected when `NODE_ENV=production` — Phase 5 |
| `EXECUTION_RATE_LIMIT_MAX` | `30` / hour / user | Execution creation rate limit (relaxed under `NODE_ENV=test`) — Phase 5 |
| `EXECUTION_USER_INFLIGHT_MAX` | `2` | Max simultaneous in-flight executions per user — Phase 5 |
| `COLLAB_INTERNAL_URL` | `http://localhost:4003` | Collaboration server internal endpoint base (version restore) — Phase 6 |
| `COLLAB_INTERNAL_TOKEN` | dev default | Shared secret with the collaboration server; dev default rejected and ≥16 chars enforced when `NODE_ENV=production` — Phase 6 |

Auth model: httpOnly cookie sessions (`cc_access` JWT + rotating `cc_refresh`),
CSRF double-submit via the `cc_csrf` cookie + `x-csrf-token` header. Details in
`../../docs/api.md`.

## Database & migrations

```bash
# from apps/api, with DATABASE_URL pointing at your Postgres
pnpm exec prisma migrate dev --name <change>   # create + apply a migration
pnpm exec prisma migrate deploy                # apply migrations (CI/prod)
pnpm exec prisma generate                      # regenerate the client
```

Migrations: Phase 2 `prisma/migrations/20261111164129_phase2_init`
(schema + `RefreshToken` model), Phase 3 `20261112044725_phase3_yjs_documents`,
Phase 4 `20261112131447_phase4_invitations` (`Invitation` model + status enum),
Phase 5 `20261112134943_phase5_execution_cancelled` (`CANCELLED` added to
`ExecutionStatus`).

**Sandbox note (this authoring environment only):** there is no Docker and no
system PostgreSQL here. `scripts/dev-db.mjs` runs a real PostgreSQL from the
`embedded-postgres` npm binaries (copied to `/tmp`, driven via `initdb`/`pg_ctl`
on port 55433):

```bash
node scripts/dev-db.mjs start     # start the sandbox Postgres
node scripts/dev-db.mjs createdb collabcode_dev
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/collabcode_dev?schema=public pnpm exec prisma migrate deploy
node scripts/dev-db.mjs stop
```

The test suite's global setup does the same automatically (creates
`collabcode_test`, applies migrations with `migrate deploy`) and falls back to
a clearly-labelled in-memory repository implementation only if the binaries
cannot start. `prisma generate`/CLI commands in this sandbox need the engine
env vars from the Phase 0 workaround (see root README).
