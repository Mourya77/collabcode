# Testing

Verified totals (Phase 8, main repo): **275 unit/integration tests + 7
Playwright E2E scenarios**, all passing. Per suite: API 101, web 93,
collaboration 48, execution 28, shared 5.

## How to run

```bash
pnpm install --frozen-lockfile

# Embedded PostgreSQL for the DB-backed suites (no system Postgres needed):
node apps/api/scripts/dev-db.mjs start                 # API suite DB :55433
COLLABCODE_PG_DIR=/tmp/collabcode-pg-collab COLLABCODE_PG_PORT=55434 \
  node apps/api/scripts/dev-db.mjs start               # collab suite DB :55434

pnpm db:generate         # Prisma client (fresh clones only; CI does this too)
pnpm -r build            # first: typecheck/tests consume @collabcode/shared's dist
pnpm -r typecheck        # strict TypeScript, all 7 workspace projects
pnpm -r test             # vitest suites (API/collab use their embedded PGs)

# Playwright E2E (boots its own PG on :55435 + the full built stack):
pnpm --filter @collabcode/e2e test
```

Individual suites: `pnpm --filter @collabcode/api test` (etc.). The API
suite's global setup records its test DB in `.test-db.json`; the collab
suite targets :55434 (`CC_COLLAB_TEST_DATABASE_URL` overrides).

## What each suite covers

| Suite | Count | Highlights |
|---|---|---|
| `@collabcode/api` | 101 | Real-Postgres integration: auth + refresh rotation/reuse revocation, CSRF, rate limits, projects/files/members, invitations v2 lifecycle, versions + restore queueing, executions incl. cancel, Phase 8 execution-disabled 503 (no record created), body-parser 400/413 envelope, health readiness |
| `@collabcode/web` | 93 | Stores (auth/projects/files/execution/chat/collab), route guards, workspace UI, chat + invitations UI, version history + diff + restore UX, Phase 8 execution-disabled calm notice, CSP-era regressions (collabStore TDZ) |
| `@collabcode/collaboration` | 48 | Real WS + real PG: token auth/membership/VIEWER read-only, persistence + restart survival + outage sweeper, version sync-back, restore endpoint (token guard), origin allowlist, Phase 8 single-port mode (health on the WS port, no second listener) |
| `@collabcode/execution` | 28 | Job validation, runner selection + production guards (subprocess refuses to boot in production), Docker argv hardening (unit), timeout/cancel/output caps with the subprocess runner |
| `@collabcode/shared` | 5 | Health/envelope helpers |
| `@collabcode/e2e` (Playwright) | 7 scenarios | A registration/login persistence · B project+file CRUD · C two-user real-time sync incl. offline/reconnect · D presence + VIEWER read-only · E chat + invitation accept · F execution run/cancel (dev subprocess runner) · G version snapshot → edit → diff → restore |

E2E notes: Chromium in the dev sandbox cannot reach the jsDelivr CDN, so the
suite fulfils Monaco requests from the local `monaco-editor` package — the
editor code under test is byte-identical; only the transport differs. The
screenshots in `docs/screenshots/` are produced by the same stack via
`apps/e2e/screenshots.mjs` (not part of the test suite).

CI: `.github/workflows/ci.yml` runs lint, the suites against a Postgres
service container, and the E2E job. It was authored in Phase 7 and first
executes when the repo is pushed.

## Phase 7 QA highlights

Full report: [qa-report.md](qa-report.md) (security findings S-1…S-18 and
their fixes) and [persistence.md](persistence.md) (Phase 6 durability
design + DB-outage recovery test).

**Concurrency (collaboration server, loopback, single machine):** 5 clients
× 40 appended lines each converge byte-identically on all clients and in
PostgreSQL, across 3 runs. Update-propagation latency: median 4–9 ms, p95
5–39 ms across the 3 runs. These are loopback numbers on one host — they
show the sync path adds little overhead; they are **not** internet latency
figures.

## Known verification gaps (honest list)

- **DockerRunner has never been run live** — there is no Docker binary in
  the development sandbox. Its `docker run` argv is unit-tested; the
  end-to-end Docker path must be verified on a real Docker host before
  execution is enabled anywhere (checklist in
  [execution-security.md](execution-security.md#docker-host-verification-checklist)).
- **`pnpm audit` never completed** in the sandbox (the proxy resets the npm
  audit endpoint). Run it in CI / on a normal network; treat dependency
  audit as an open item until then.
- **Dockerfiles / Compose** were reviewed structurally (multi-stage,
  non-root, healthchecks) but not `docker build`-verified in the sandbox.
- **CI** has not executed yet (repo not pushed at Phase 8 prep time).
