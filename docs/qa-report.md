# QA Report — Phase 7: Comprehensive Testing, Security & Performance

**Date:** 2026-11-13 · **Environment:** authoring sandbox (Linux, Node 24 locally;
CI targets Node 20/22) · **Rule:** every number below comes from an actual run
in this environment. Anything not run is labelled as such.

---

## 1. Test results

### Unit / integration suites (vitest, real PostgreSQL unless noted)

| Suite | Before Phase 7 | After Phase 7 | Δ | Notes |
|---|---|---|---|---|
| `@collabcode/shared` | 5 | **5** | — | unchanged |
| `@collabcode/api` | 81 | **96** | +15 | `test/phase7.test.ts` — see §2 |
| `@collabcode/web` | 77 | **90** | +13 | +12 flows in `flows.test.tsx`, +1 collab TDZ regression in `collab.test.tsx` |
| `@collabcode/collaboration` | 32 | **39** | +7 | +5 env-guard units, +2 in `test/phase7.test.ts` (origin guard, concurrency) |
| `@collabcode/execution` | 25 | **28** | +3 | `test/phase7.test.ts` — error-envelope tests |
| **Total** | **220** | **258** | **+38** | all suites green in the final verification run |

Also verified in **external-database mode** (the mode CI uses, §5): api 96/96,
collaboration 38 passed + 1 skipped (the DB-outage test, which works by
stopping the suite's *own* embedded Postgres and is therefore embedded-mode
only — it still runs, and passes, in the default mode).

Typecheck: **7/7 workspaces pass**. Build: **7/7 pass**. Lint: **ESLint
0 errors repo-wide** (1 pre-existing warning: an unused variable in
`apps/api/test/phase6.test.ts`, left deliberately). Before Phase 7 the
per-workspace `lint` scripts were a `tsc --noEmit` placeholder and a real
ESLint pass reported ~2,690 problems (99% from the generated Prisma client,
which is now ignored); lint is real now and wired into CI.

### Playwright E2E (`apps/e2e`, new in Phase 7) — 7/7 scenarios PASS

Run command: `pnpm --filter @collabcode/e2e test`. The suite boots the real
stack — built API + collaboration + execution services and the production
web build via `vite preview` — against a dedicated embedded PostgreSQL
(port 55435), with Chromium driving real browser contexts. Final run:
**7 passed (1.4m)**, and the suite passed end-to-end twice in a row.

| # | Scenario | Result |
|---|---|---|
| A | Register → login → create project | ✅ pass |
| B | Invite second user (dev-mode invite link) → accept → member visible | ✅ pass |
| C | Two browser contexts edit the same file, both directions | ✅ pass |
| D | Synced text + presence avatars + **remote cursor decoration rendered** (`.yRemoteSelectionHead-*` present in the other client) | ✅ pass |
| E | Create `hello.py`, run it (subprocess runner) → stdout `42`, exit code 0 | ✅ pass |
| F | Labelled snapshot → edit → restore via confirmation → editor shows pre-snapshot content, post-snapshot edit gone | ✅ pass |
| G | VIEWER: editor read-only (typing changes nothing), Run disabled, direct API file-create → **403** | ✅ pass |

Two environment notes, honestly stated:

- **Monaco CDN:** Chromium in this sandbox cannot open a proxy tunnel to
  `cdn.jsdelivr.net` (`ERR_TUNNEL_CONNECTION_FAILED` for every proxy
  variant; `curl` through the same proxy succeeds). The app loads Monaco
  from that CDN, so the E2E contexts fulfil those URLs from the **real
  `monaco-editor` package installed in `apps/web/node_modules`** (the same
  `min/vs` AMD tree the CDN serves; local package is 0.57.0 vs the loader's
  pinned 0.55.1 path). The application is unmodified and everything else —
  app bundle, REST, WebSockets, execution — is the real network path.
- **Two real bugs were found by E2E and fixed** (see §2, items S-9 and S-10).
  Neither was visible to the unit suites: the workspace had never run in a
  real browser before this phase.

### Concurrency test (collaboration suite, real server + real PostgreSQL)

5 Hocuspocus clients on one document, each appending 40 uniquely marked
lines in 4 interleaved bursts (200 markers total), one client disconnecting
mid-run, editing offline and reconnecting; the persisted `YjsDocument` is
decoded and compared at the end. All assertions pass: byte-identical
convergence on every client, all 200 markers present, offline edits merge,
persistence matches. Sync latency (edit on one client → observed on
another, 20 samples per run) measured on three runs in this environment:

| Run | median | p95 | max |
|---|---|---|---|
| 1 | 9 ms | 39 ms | 39 ms |
| 2 | 8 ms | 10 ms | 10 ms |
| 3 (final) | 4 ms | 5 ms | 5 ms |

(Loopback WebSockets on a shared sandbox CPU — indicative, not a
production benchmark.)

---

## 2. Security audit — findings

Severity: **C** critical · **H** high · **M** medium · **L** low.
Status: **Fixed** (this phase, with regression test) · **Verified safe**
(audited, no change needed) · **Remaining risk** (documented, not fixed).

| # | Area | Finding | Sev | Status |
|---|---|---|---|---|
| S-1 | Chat WebSocket | The chat gateway authenticated by cookie but performed **no Origin check** — a cross-site WebSocket hijacking (WS-CSRF) vector. | H | **Fixed**: upgrade requests with a foreign `Origin` are rejected (403) against the API's `CORS_ORIGINS` allowlist; no-Origin (native) clients unaffected. Regression tests: foreign origin rejected; allow-listed and no-Origin connect. |
| S-2 | Collaboration WebSocket | Same missing Origin check on the Hocuspocus endpoint (cookie-free bearer token in the connect payload, but the *internal restore* and awareness paths ride the same server). | H | **Fixed**: new `ALLOWED_ORIGINS` env (default `http://localhost:5173`); check enforced in `onUpgrade` (the real handshake gate in @hocuspocus/server 2.15.3) with `onConnect` as a second layer. Regression tests in the collab phase7 suite. |
| S-3 | Collab JWT secret | The collaboration service accepted the API's **known dev-default JWT secret** and short secrets in production. | H | **Fixed**: production `loadEnv` rejects secrets < 32 chars and the known dev default (5 new unit tests). The API, and both internal tokens (`COLLAB_INTERNAL_TOKEN`, `EXECUTION_INTERNAL_TOKEN`) on all three services, were verified to already hard-fail on dev defaults in production. |
| S-4 | Chat resource exhaustion | No per-socket limits: unbounded frame size/flood on the chat gateway. | M | **Fixed**: `maxPayload` 32 KiB; per-socket rate limit (default 30 frames / 10 s) with `RATE_LIMITED` error frames; socket closed (4429) after 3 violations. Tests: flood → throttled + 4429; oversized frame → close 1009. Hocuspocus does not expose a payload cap in 2.15.3; collab updates are indirectly bounded by the 1M-char file cap — documented, not fixed (see §4). |
| S-5 | API error handling | Body-parser failures (malformed JSON, oversized body) fell through to **500**; correctness/observability issue and inconsistent with the API envelope. | M | **Fixed**: mapped to 400 `VALIDATION_ERROR` / 413 `PAYLOAD_TOO_LARGE`. Tests cover both, plus unknown-route 404 envelope and a throwing-repository 500 that leaks no internals. |
| S-6 | Execution errors | Runner exceptions were **echoed to the caller** (internal paths/messages), and malformed JSON got Express's default HTML error page. | M | **Fixed**: generic "Execution failed internally." to callers, raw error only in server logs; JSON error middleware maps malformed → 400, oversized → 413. Tests assert the 500 body contains neither the fake path nor secret marker used to trigger it. |
| S-7 | Web CSP | No Content-Security-Policy on the web app. | M | **Fixed**: CSP + `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy in `vite.config.ts` (dev + preview) and mirrored in `apps/web/vercel.json` for deploy-time. The policy allows exactly what the app uses, including the jsDelivr origins Monaco needs for scripts/styles/fonts/workers. |
| S-8 | API docs surface | Swagger UI was mounted in production. | L | **Fixed**: UI not mounted when `NODE_ENV=production` (OpenAPI JSON remains). Also added `GET /api/health/ready` (DB ping → 200/503) alongside liveness, tested both ways. |
| S-9 | **Collab session crash (real browser only)** | `HocuspocusProvider` fires `onStatus`/`onSynced` **synchronously from its constructor**; `collabStore.start()` passed callbacks that referenced the `const session` binding being initialized → `ReferenceError: Cannot access 'session' before initialization`, the session was never created and the editor never bound. Unit tests mock the provider and never fired callbacks during construction, so Phases 3–6 could not see this. | C | **Fixed**: session is a nullable `let` assigned after construction (callbacks see `null` during construction, which the staleness guard handles). Regression test makes the mocked factory fire callbacks synchronously during creation. Found by the Phase 7 E2E debug run. |
| S-10 | **CSP broke Monaco (self-inflicted, E2E-caught)** | The first CSP (S-7) omitted the CDN origin for `style-src`/`font-src`; Monaco's stylesheet was blocked and the editor never rendered. | M | **Fixed**: jsDelivr added to `style-src` and `font-src` in both `vite.config.ts` and `vercel.json`; E2E scenario A is the regression check. |
| S-11 | Auth/session | Cookie attributes audited: access + refresh `HttpOnly`, `SameSite=Lax`, `Secure` in production, refresh cookie scoped to `Path=/api/auth`; CSRF cookie intentionally JS-readable (double-submit). Refresh rotation + reuse-revokes-family intact (Phase 2 tests). JWT `HS256` pinned. Cookie attributes now asserted by a Phase 7 test. | — | **Verified safe** |
| S-12 | CSRF coverage | State-changing routes enumerated (auth, projects, members, files, versions incl. restore, invitations, executions, chat): the double-submit middleware is mounted globally on `/api` before all routers; WS surfaces are covered by S-1/S-2 Origin checks. | — | **Verified safe** |
| S-13 | XSS | Repo-wide grep: **no `dangerouslySetInnerHTML`** and no HTML rendering of user content in the web app; chat messages, file/project/user names render as React text; Monaco content is code, never HTML. | — | **Verified safe** |
| S-14 | Injection / paths | Prisma parameterizes throughout; the only `$queryRaw` is the static `SELECT 1` readiness ping; `$executeRawUnsafe` appears only in test truncation helpers. File-name traversal validation (incl. move-into-own-descendant, tested) and execution path validation re-checked; file content cap 1,000,000 chars enforced on create/update/version (400 on exceed — tested); execution workspace capped at 1 MiB total. | — | **Verified safe** |
| S-15 | Rate limiting | API: global 300/15 min + auth 20/15 min limiters (pre-existing); execution: per-user hourly + in-flight caps (Phase 5); chat: S-4. Registration/login abuse is covered by the auth limiter. | — | **Verified safe** |
| S-16 | Secrets | No committed secrets (only `.env.example` placeholders); frontend `VITE_*` variables contain only the API/collab URLs; API 500 responses are generic (tested, S-5). | — | **Verified safe** |
| S-17 | Execution sandbox | Phase 5 posture re-audited (no live Docker claims): DockerRunner argv pinned by unit tests (network none, 256 MB, 0.5 CPU, pids 64, non-root, cap-drop ALL, no-new-privileges, read-only FS, fixed images); SubprocessRunner refuses to boot in production. | — | **Verified safe** (audit only) |
| S-18 | Dependency audit | `pnpm audit --prod` and full `pnpm audit` could **not be completed**: the sandbox proxy resets the npm audit endpoint (`ECONNRESET` to `registry.npmjs.org/-/npm/v1/security/audits/quick`) across 15+ attempts including a retry loop. No advisory counts exist to report; no dependency was changed blind. | — | **Remaining risk**: run `pnpm audit` in CI or any unfiltered network and triage critical/high before deploying. |

---

## 3. Performance & observability changes

- **Index:** `Execution @@index([userId, createdAt])` — justified by
  `executions.listForUser` (filter by user, order by `createdAt` desc);
  migration `20261113063229_phase7_indexes`, applied and verified. The other
  candidates were already indexed (`ChatMessage [projectId, createdAt]`,
  `File [projectId, parentId]`, `Invitation [email, status]`,
  `Invitation.tokenHash` unique) — no speculative indexes added.
- **Readiness:** `GET /api/health/ready` (Prisma `SELECT 1` ping → 200/503)
  next to the existing liveness probe; collab health still exposes
  `pendingStores`.
- **Logging:** the execution service now emits structured JSON logs
  (`service: "execution"`, `execute.started/finished/cancelled` with
  executionId/language/status/durationMs) via a small dedicated logger,
  aligning it with the API (pino) and collab (structured winston).
- **React:** workspace render paths reviewed (Zustand slice selectors
  already scope rerenders; Monaco is keyed per file by design). No
  memoization change was both clearly beneficial and safely test-covered,
  so **no speculative refactor was made** — recorded here as the review
  outcome.
- **Large files:** guards confirmed and tested — files API content cap
  (1M chars → 400), execution total-input cap (1 MiB), chat frame cap
  (32 KiB, S-4).

---

## 4. CI (`.github/workflows/ci.yml`)

Rewritten into two jobs:

1. **test** (Node 20 + 22 matrix): two **Postgres 16 service containers**
   (one per DB-backed suite) → install (`--frozen-lockfile`) → Prisma
   validate + client generation → **real ESLint** (`pnpm -r lint`) →
   typecheck → unit/integration tests → build. The suites pick the service
   databases up via `CC_TEST_DATABASE_URL` / `CC_COLLAB_TEST_DATABASE_URL`
   (new env overrides in the suites' global setups + the collab vitest
   config; unset locally = embedded Postgres as before).
2. **e2e**: installs Chromium and runs `pnpm --filter @collabcode/e2e test`;
   failure artifacts (traces/screenshots) are uploaded.

**Honesty note:** CI has **not** been executed on GitHub — the repository
has not been pushed (Mourya's call). The workflow YAML parses cleanly, and
every job command was replicated locally in this sandbox, including the
external-database mode against a real PostgreSQL on a different port
(api 96/96; collab 38 pass + 1 embedded-only skip). First remote run
happens on push.

---

## 5. Limitations & remaining risks

- **Dependency audit unavailable** (S-18) — no advisory data for the
  current lockfile; triage before any deployment.
- **DockerRunner still not live-verified** — no Docker in this sandbox;
  all live execution (unit, API integration, E2E) used the dev-only
  SubprocessRunner. Do not deploy execution publicly until the Docker path
  is verified on a Docker host.
- **Single-process in-memory state** — workspace presence, chat rooms and
  the collab version sync-back throttle live in one process each (Redis
  remains a future phase), so the current deployment shape is one instance
  per service.
- **Collab WebSocket payload size** — Hocuspocus 2.15.3 exposes no
  `maxPayload`; document updates are bounded indirectly (1M-char file cap),
  but a malicious client can send large sync frames to its own document.
  Chat (32 KiB) and REST bodies (1 MB JSON) are capped.
- **Invitations are dev-link only** — no SMTP is bundled; the `Mailer`
  interface returns a dev-mode link (used by E2E scenario B exactly as a
  user would receive it in dev).
- **Sandbox E2E specifics** — Chromium/Monaco CDN interception (§1) and a
  relocated E2E Postgres data dir (`COLLABCODE_E2E_PG_DIR`) because the
  sandbox's 512 MB `/tmp` cannot hold three embedded-Postgres data dirs at
  once. Neither affects CI.
- **Pre-existing residuals (unchanged):** a hard-killed collab process can
  lose up to one debounce window of edits held by no connected client
  (`docs/persistence.md`); Monaco loads from CDN rather than self-hosted.
