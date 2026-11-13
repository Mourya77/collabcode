# @collabcode/collaboration

Real-time collaboration server (Phase 3): Hocuspocus (Yjs) WebSocket server on
port 4001, health HTTP on 4003 (`GET /` returns the HealthStatus JSON).

## Protocol

1. The browser asks the REST API for a collab token:
   `POST /api/collab/token { projectId }` (cookie auth + CSRF, project members
   only) → 10-minute HS256 JWT with claims `{ sub, projectId, role, name, aud: "collab" }`.
2. The browser connects with document name `project:<projectId>:file:<fileId>`
   and that token.
3. `onAuthenticate` verifies the JWT, then **never trusts the document name**:
   it loads the File, requires `file.projectId` to match both the name and the
   token, and requires a `ProjectMember` row. VIEWERs get a readOnly
   connection (Hocuspocus enforces it server-side — their changes are dropped).
4. Documents sync as Yjs CRDT updates (never last-write-wins, never
   full-content broadcasts). Awareness carries presence/cursors (ephemeral).

## Persistence

- `@hocuspocus/extension-database` fetch/store on the `YjsDocument` table
  (`state Bytes`), debounced: `STORE_DEBOUNCE_MS` (default 2000) idle,
  `STORE_MAX_DEBOUNCE_MS` (default 10000) max.
- First load with no stored state seeds `Y.Text("content")` from the latest
  `DocumentVersion`; seeding can never run twice for a file.
- Each store also syncs the plain text back to the REST world as a new
  `DocumentVersion` (source `AUTOSAVE`) when it changed — throttled to one
  per file per `VERSION_SYNC_MIN_INTERVAL_MS` (default 30000), authored by
  the last editor (in-memory tracking), falling back to the project owner.
- **Phase 6 hardening:** fetch/store retry with exponential backoff
  (`COLLAB_STORE_MAX_ATTEMPTS`, default 4); stores that exhaust the budget
  park in a pending map and are retried by a sweeper
  (`COLLAB_STORE_SWEEP_MS`, default 5000) — never dropped. Successful
  stores broadcast a `persisted` stateless ack to clients; parked stores
  broadcast `persist-failed`. Graceful shutdown force-stores every loaded
  document before exit. Full guarantees: `../../docs/persistence.md`.
- **Internal restore endpoint (Phase 6):** `POST /internal/documents/:documentName/restore`
  on the health port, guarded by the `COLLAB_INTERNAL_TOKEN` shared secret.
  Applies replacement content to the live document via a direct connection
  (CRDT transaction, origin `restore`) — used only by the API's version
  restore. Not a public API.

## Database access

This service has its **own** Prisma client, generated from
`prisma/schema.prisma`, which contains only the models it needs (User,
Project, ProjectMember, File, DocumentVersion, YjsDocument).
`apps/api/prisma/schema.prisma` is the canonical superset and owns all
migrations; both services use the same `DATABASE_URL`. The duplication is
deliberate service separation. Regenerate with `pnpm --filter
@collabcode/collaboration build` (or `node scripts/generate.mjs`) — in this
sandbox the script pins Prisma to the locally installed engines because the
engine CDN is unreachable.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Same PostgreSQL database as the API |
| `JWT_SECRET` | — (required*) | Verifies collab tokens (HS256) |
| `COLLAB_JWT_SECRET` | falls back to `JWT_SECRET` | Optional separate secret |
| `PORT` | 4001 | WebSocket port |
| `HEALTH_PORT` | 4003 | Health HTTP port |
| `STORE_DEBOUNCE_MS` / `STORE_MAX_DEBOUNCE_MS` | 2000 / 10000 | Persistence debounce |
| `VERSION_SYNC_MIN_INTERVAL_MS` | 30000 | DocumentVersion sync throttle |
| `COLLAB_INTERNAL_TOKEN` | dev default | Shared secret for the internal restore endpoint (health port); dev default rejected in production, ≥16 chars enforced — Phase 6 |
| `COLLAB_STORE_MAX_ATTEMPTS` | 4 | Fetch/store retry budget before a store parks as pending — Phase 6 |
| `COLLAB_STORE_SWEEP_MS` | 5000 | Pending-store sweeper interval — Phase 6 |

## Run

```bash
pnpm --filter @collabcode/collaboration dev    # tsx watch
pnpm --filter @collabcode/collaboration build  # generate client + tsc
pnpm --filter @collabcode/collaboration start  # node dist/index.js (after build)
pnpm --filter @collabcode/collaboration test   # 25 tests: units + A–H against real Postgres
```

Graceful shutdown on SIGTERM/SIGINT (Hocuspocus destroy + Prisma disconnect).
Lifecycle events are logged as single-line JSON (`onConnect`,
`onAuthenticate`, `onLoadDocument`, `onChange`, `onDisconnect`, stores).
