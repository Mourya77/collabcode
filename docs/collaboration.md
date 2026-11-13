# Collaboration — real-time editing, presence and persistence

How CollabCode's real-time layer works: the Hocuspocus/Yjs collaboration
server (`apps/collaboration`), how connections are authenticated, how
documents persist, and how the two kinds of presence fit together.

Related: [architecture.md](architecture.md) (system overview),
[persistence.md](persistence.md) (durability guarantees + recovery table),
[api.md](api.md) (the token endpoint).

## Shape of the system

```mermaid
sequenceDiagram
  participant C as Client (browser)
  participant A as API (4000)
  participant S as Collaboration server
  participant DB as PostgreSQL
  C->>A: POST /api/collab/token {projectId} (cookie auth + CSRF)
  A->>DB: ProjectMember lookup (non-member → 404)
  A-->>C: 10-minute collab JWT (aud "collab")
  C->>S: WebSocket connect — document project:<pid>:file:<fid> + token
  S->>S: Origin allowlist check (upgrade) + JWT verify (HS256, aud, exp)
  S->>DB: File lookup + project match + ProjectMember row (DB role wins)
  S-->>C: reject, or accept (VIEWER ⇒ readOnly connection)
  S->>DB: fetch YjsDocument.state (or seed from latest DocumentVersion)
  C->>S: Yjs sync + awareness (cursors, presence)
  S-->>C: updates broadcast; persisted acks via stateless messages
```

- **One Y.Doc per file.** The shared `Y.Text("content")` is bound to Monaco
  via y-monaco. The server is a relay + persistence point: clients converge
  via the CRDT itself — there is no operational-transform server logic and
  no last-write-wins.
- **Document names are never trusted.** `project:<projectId>:file:<fileId>`
  is parsed, both ids must be UUIDs, the File row must belong to the claimed
  project, the token's `projectId` claim must match, and a `ProjectMember`
  row must exist for the token's subject. Folders cannot be documents.

## Authentication & authorization

| Layer | Mechanism |
|---|---|
| Token minting | API endpoint `POST /api/collab/token` — cookie session + CSRF, members only (non-members get 404 so project existence is not leaked) |
| Token | HS256 JWT, `aud: "collab"`, 10-minute TTL, claims `sub`, `projectId`, `role`, `name`; signed with the API's `JWT_SECRET` (collab accepts `COLLAB_JWT_SECRET` as an override) |
| Refresh | The web provider uses an async token function — every reconnect fetches a fresh token instead of replaying an expired one |
| Authorization | The role inside the token is advisory. The server re-reads the membership role from PostgreSQL; that decides `connection.readOnly`. Hocuspocus then discards a VIEWER's document updates server-side — they never apply and never broadcast |
| Origin guard (Phase 7) | Browser `Origin` headers are checked against `ALLOWED_ORIGINS` twice: at the HTTP upgrade (`onUpgrade`, before any socket exists) and again in `onConnect`. Non-browser clients (no Origin) rely on token auth alone |

Production secret rules (enforced at boot in `apps/collaboration/src/config/env.ts`):
JWT secrets must be ≥32 chars and never the known dev default; the internal
token must be ≥16 chars and never the dev default.

## Persistence (summary — full detail in persistence.md)

- `@hocuspocus/extension-database` stores the binary Yjs state in the
  `YjsDocument` table (`fileId` unique, `state Bytes`), debounced
  (2 s idle / 10 s max — never per keystroke).
- First load with no state row seeds the Y.Text from the latest
  `DocumentVersion.content`; once state exists, seeding never re-runs, so
  restarts cannot duplicate content.
- Stores are retried with backoff; a store that exhausts retries is parked
  and a sweeper retries it every 5 s. A graceful shutdown flushes every
  loaded document before exiting.
- After each successful store, connected clients receive a stateless
  `{"type":"persisted","at":…}` message (and `persist-failed` on terminal
  failure) — this drives the editor's save-status chip, so "Saved" in the
  UI means the database actually acknowledged the write.
- A throttled sync-back (≥30 s per file) mirrors the plain text into
  `DocumentVersion` (source `AUTOSAVE`, authored by the last editor) so the
  REST world — version history, downloads, execution file resolution —
  stays truthful.
- **Restore goes through the CRDT, never around it:** version restore calls
  the internal endpoint below, which transacts the live Y.Doc; every
  connected editor converges via normal sync and persistence flows through
  the normal debounced store.

## Internal endpoint (API → collab)

`POST /internal/documents/<documentName>/restore` with header
`x-internal-token: <COLLAB_INTERNAL_TOKEN>` (timing-safe comparison).
Replaces the document's text with the given content through a CRDT
transaction (origin `"restore"`). 401 without the token, 413 over 2 MB,
400 on malformed names/bodies. It is not a public API and browsers never
call it.

## Two kinds of presence (deliberately separate)

| | Document presence | Workspace presence |
|---|---|---|
| Transport | Yjs Awareness on the collab socket | In-memory registry in the API process |
| Scope | One file: cursors, selections, who's editing it | One project: who's online, which file they have open |
| Persisted | Never (ephemeral by design) | Never (rebuilt from connections; REST merges it with the DB member roster at `GET /projects/:id/presence`) |
| UI | Remote carets + names in the editor, header avatars | Members list in the workspace's Collaboration tab |

Cursor colours are stable per user (FNV-1a hash of the user id into an
8-colour palette) on both client and server-rendered awareness.

## Ports & the single-port mode (Phase 8)

Locally the server runs dual-port: WebSockets on 4001, the platform HTTP
surface (health + internal restore) on 4003. Hosts like Render expose
exactly **one** port per service, so in production the server switches to
**single-port mode** — derived automatically when `NODE_ENV=production` and
`PORT` is set (Render injects `PORT`), or forced with `SINGLE_PORT=true`:
the Hocuspocus HTTP server then also serves `GET /health` and the restore
endpoint on the WS port via the `onRequest` hook, and no second listener
is started. The API's `COLLAB_INTERNAL_URL` points at the collab service's
public origin in that deployment shape. Single-port behaviour is covered
by `apps/collaboration/test/phase8.test.ts` (health, restore and WS sync
on one port; no second listener).

## Scaling limits (honest)

Single-process today: awareness, the version sync-back throttle and
pending-store state live in one collab process. Running multiple collab
instances requires a shared backplane (Redis pub/sub for Hocuspocus plus
shared persistence coordination) — designed for, not yet built. The
current production shape is one instance of the collab service.
