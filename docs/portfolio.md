# CollabCode — portfolio pack

## Project description

CollabCode is a real-time collaborative IDE that runs entirely in the
browser: shared workspaces with role-based access, a Monaco editor where
multiple users type in the same file at once with live cursors, team chat,
a full version history with diffs and restore, and sandboxed execution of
JavaScript, Python and C++. It is built as a strict-TypeScript pnpm
monorepo — a React frontend, an Express/Prisma/PostgreSQL API, a Hocuspocus
(Yjs CRDT) collaboration server, and a separate internal-only execution
service — with cookie-session auth (Argon2id, rotating refresh tokens),
hash-only invitation links, and durability engineering (retrying document
persistence with server-acknowledged save state) throughout.

The project was built in verified phases, each with its own test suite
against real PostgreSQL and real WebSockets: 275 unit/integration tests
plus a 7-scenario Playwright E2E suite, all passing, including a 5-client
concurrency test where 200 interleaved lines converge byte-identically.
Security was treated as a feature: a dedicated audit pass, CSP headers,
WebSocket origin checks, and an execution sandbox model (hardened Docker
runs, no network, resource caps) that stays **disabled in the public demo
until its Docker host is verified** — a deliberate, documented decision
rather than a gap.

## GitHub About (≤350 chars)

> Real-time collaborative IDE in the browser — Yjs CRDT co-editing with live cursors, Monaco, team chat, version history with restore, and sandboxed JS/Python/C++ execution. React + Express + Hocuspocus + PostgreSQL monorepo, 275 tests + Playwright E2E, strict TypeScript.

(272 characters.)

**Topics:** `collaborative-editing`, `crdt`, `yjs`, `monaco-editor`,
`real-time`, `ide`, `react`, `typescript`, `express`, `postgresql`,
`prisma`, `websockets`, `pnpm-monorepo`, `playwright`, `docker`

## Demo walkthrough (~3 minutes)

1. **Landing (0:00)** — "This is CollabCode, a collaborative IDE. The pill
   under the headline is a *live* health check against the API — nothing on
   this page is mocked." Click **Sign up**, register an account; you land
   on the dashboard.
2. **Create a project (0:20)** — Create "Apollo", open it. Point out the
   seeded files and the editor: "Real Monaco — the VS Code editor — not a
   textarea."
3. **Invite (0:40)** — Click **Invite**, send an Editor invitation to a
   second account. "Only the SHA-256 hash of the token is stored; nobody
   becomes a member until they accept, and the account email must match."
   In the second browser (already signed in as the invitee), open the
   invite link and accept.
4. **Co-edit (1:00)** — Both browsers open `src/main.ts`. Type in one;
   the text appears in the other with your coloured cursor flag. "This is
   a Yjs CRDT — no locks, no save button, and if I go offline and keep
   typing, it merges when I reconnect. The header chip is the server
   telling us the document is actually persisted."
5. **Chat (1:40)** — Switch the invitee to the Chat tab, send a message;
   it appears in the first browser. "Chat is persisted first, then
   broadcast — refresh and the history is still there."
6. **Version history (2:00)** — Back in browser one, click **History**,
   create a labelled snapshot, type another line, reopen History and open
   the diff: snapshot vs live document, side by side. Click **Restore**:
   "Restore doesn't overwrite the database — it snapshots the current
   state first, then applies the old version through the live document,
   so connected users see it arrive like an edit."
7. **Execution (2:30)** — Open `analysis.py` (or any `.py`/`.js`/`.cpp`
   file) and click **Run**: real output, exit code and duration in the
   Output panel. On the public demo, say instead: "On the hosted demo,
   execution is deliberately disabled — the API returns a 503 with a
   clear notice. The runner is a hardened, network-less Docker sandbox,
   and I won't expose untrusted code execution publicly until that Docker
   host is verified end-to-end."
8. **Close (2:50)** — "Four services, one monorepo: 275 tests, a
   Playwright E2E suite, and a security audit — all in the repo docs."

## Resume bullets

- Built **CollabCode**, a real-time collaborative IDE (React 18, TypeScript,
  Monaco) with **Yjs CRDT** co-editing — live cursors, presence, and
  offline merge — backed by Express, Prisma and PostgreSQL in a pnpm
  monorepo of 4 services and 2 shared packages.
- Implemented secure auth from scratch: **Argon2id** hashing, httpOnly
  cookie sessions with **rotating refresh tokens** (reuse revokes all),
  CSRF double-submit protection, and role-based access (OWNER/EDITOR/
  VIEWER) enforced server-side in both the API and the collaboration
  server, including protocol-level read-only for viewers.
- Engineered document durability: debounced CRDT persistence with
  retry/backoff, a pending-store sweeper and graceful-shutdown flush,
  surviving a full database outage in tests without losing edits; added
  version history with labelled snapshots, Monaco diffing and restore
  applied through the live document.
- Designed a sandboxed code-execution service for **JavaScript, Python and
  C++**: internal-only API, Docker runs with no network, CPU/memory/PID
  caps, non-root and read-only FS; shipped a policy-gated
  "execution-disabled" mode (503 + UI notice) for deployments without a
  verified Docker host.
- Verified with **275 automated tests** (Vitest, real PostgreSQL and real
  WebSockets — no mocked database) plus **7 Playwright E2E scenarios**; a
  5-client × 40-line concurrency test converges byte-identically (median
  propagation 4–9 ms on loopback).
- Ran a full security/QA pass (18 findings fixed with regression tests):
  WebSocket origin allowlists, CSP hardening, leak-free error envelopes,
  chat rate/payload limits; ESLint at **0 errors** repo-wide and a GitHub
  Actions CI pipeline (lint → typecheck → test → build → E2E).
- Prepared production deployment: Render Blueprint + Vercel config,
  single-port WebSocket/health serving for one-port hosts, two-pass
  secret wiring, and fail-fast guards that reject development secrets in
  production.

## Links

- Live demo: *(added once the deployment is verified — see README)*
- Screenshots: `docs/screenshots/`
- Deep dives: `docs/architecture.md`, `docs/collaboration.md`,
  `docs/execution-security.md`, `docs/testing.md`, `docs/qa-report.md`
