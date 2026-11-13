# CollabCode API reference (Phase 2 + Phase 3 collaboration tokens + Phase 4 invitations/chat/presence)

Base URL: `http://localhost:4000` (dev). Interactive docs: Swagger UI at
`/api/docs`, raw spec at `/api/openapi.json`.

## Response envelope

Every `/api/*` JSON response uses the envelope:

```json
{ "success": true, "data": { }, "error": null, "requestId": "…" }
{ "success": false, "data": null, "error": { "code": "CONFLICT", "message": "…" }, "requestId": "…" }
```

`requestId` is also returned in the `x-request-id` header and included in the
server's structured (pino) logs. Health endpoints (`/health`, `/api/v1/health`)
are the exception — they return their plain Phase 0 shape.

## Collaboration tokens (Phase 3)

### `POST /api/collab/token`
Cookie auth + CSRF (same as every authenticated write). Body: `{ "projectId": "<uuid>" }`.
Returns a short-lived JWT the browser hands to the collaboration server
(WebSocket, port 4001) — see `docs/architecture.md` for the full flow.

```json
{ "token": "<jwt>", "user": { "id": "…", "name": "…", "email": "…" }, "role": "EDITOR", "expiresAt": "2026-11-12T05:10:00.000Z" }
```

- Token: HS256, signed with `JWT_SECRET`, claims `{ sub, projectId, role, name, aud: "collab" }`, TTL 10 minutes.
- Errors: `401 UNAUTHORIZED` when not signed in; `404 NOT_FOUND` when the project does not exist **or the caller is not a member** (existence is never leaked); `400 VALIDATION_ERROR` for a malformed body.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod validation failed, or an invalid file name (contains `/`, `\\`, `..`, or is empty) |
| `UNAUTHORIZED` | 401 | Missing/expired access token, or bad credentials (login always uses one generic message — no user enumeration) |
| `FORBIDDEN` | 403 | Authenticated but not allowed (role too low, self role-change, last-owner rules) |
| `NOT_FOUND` | 404 | Resource missing — **also returned to non-members asking about a project**, so project existence never leaks |
| `USER_NOT_FOUND` | 404 | (Legacy Phase 2 code — invitations v2 no longer require an existing account) |
| `CONFLICT` | 409 | Duplicate email, duplicate file path in a project, already a member, invitation already settled |
| `DUPLICATE_INVITATION` | 409 | A PENDING invitation already exists for that (project, email) — Phase 4 |
| `INVITATION_EMAIL_MISMATCH` | 403 | Signed in with a different email than the invitation was sent to (tokens are not transferable) — Phase 4 |
| `INVITATION_EXPIRED` | 410 | Invitation is past its `expiresAt` — Phase 4 |
| `RATE_LIMITED` | 429 | Rate limit exceeded (global 300/15 min/IP, auth routes 20/15 min/IP; env-tunable) |
| `UNSUPPORTED_LANGUAGE` | 400 | Execution entry file's extension is not runnable (.js/.mjs/.cjs, .py, .cpp/.cc/.cxx) — Phase 5 |
| `TOO_MANY_RUNNING` | 429 | The caller already has the maximum in-flight executions (default 2) — Phase 5 |
| `EXECUTION_NOT_RUNNING` | 409 | Cancel requested for an execution that is already in a terminal state — Phase 5 |
| `COLLAB_UNAVAILABLE` | 502 | Version restore could not be applied because the collaboration server is unreachable/refused — the document is left untouched — Phase 6 |
| `INTERNAL` | 500 | Unexpected server error |

## Authentication — cookies, not bearer headers

Login/register/refresh set three cookies:

| Cookie | httpOnly | Path | Lifetime | Purpose |
|---|---|---|---|---|
| `cc_access` | yes | `/` | 15 min | JWT (HS256, `sub` = user id) |
| `cc_refresh` | yes | `/api/auth` | 7 days | Opaque 32-byte refresh token; only its SHA-256 hash is stored (`RefreshToken` table) |
| `cc_csrf` | **no** | `/` | session of the refresh token | Double-submit CSRF token |

- Passwords are hashed with **Argon2id** (`argon2` package); hashes never leave
  the service layer and never appear in responses.
- **Refresh rotation:** every `POST /api/auth/refresh` revokes the presented
  token's row and issues a new one. Presenting an already-revoked token is
  treated as theft: **all** of that user's refresh tokens are revoked.
- `POST /api/auth/logout` revokes the refresh-token row and clears the cookies.
- `Secure` is set on cookies only in production (`COOKIE_SECURE`); `SameSite=Lax`.

## CSRF (double-submit)

Every mutating request (`POST`/`PATCH`/`DELETE` under `/api`) must send the
`x-csrf-token` header equal to the `cc_csrf` cookie. The web client reads the
cookie and adds the header automatically; when the cookie is absent it first
calls `GET /api/auth/csrf` (which sets it) and retries. GET requests, health
checks and the OpenAPI endpoints are exempt.

## Pagination

List endpoints accept `?page=` (default 1) and `?limit=` (default 20, max 100)
and return `{ items, total, page, limit }`. `GET /api/projects` also accepts
`?search=` (case-insensitive substring on project name).

## Endpoints

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | `{name, email, password ≥ 8}` → 201 user + cookies; duplicate email → 409 |
| POST | `/api/auth/login` | → user + cookies; bad credentials → 401 generic; rate-limited |
| POST | `/api/auth/logout` | Revokes the refresh token, clears cookies |
| POST | `/api/auth/refresh` | Rotates the refresh token (see above) |
| GET | `/api/auth/me` | Current user from the access cookie |
| GET | `/api/auth/csrf` | Sets/returns the CSRF cookie (client bootstrap) |

### Users
| Method | Path | Notes |
|---|---|---|
| GET | `/api/users/me` | Current user |
| PATCH | `/api/users/me` | `{name?, avatarUrl?}` (avatarUrl nullable) |

### Projects
| Method | Path | Min. role | Notes |
|---|---|---|---|
| POST | `/api/projects` | — | Creates project + OWNER membership + seed files (`welcome.md`, `src/`, `src/main.ts`) with initial versions, in one transaction |
| GET | `/api/projects` | member | Only the caller's projects; `search`, pagination; each item includes the caller's `role` and `fileCount` |
| GET | `/api/projects/:projectId` | VIEWER | Non-members get 404 |
| PATCH | `/api/projects/:projectId` | OWNER | `{name?, description?}` |
| DELETE | `/api/projects/:projectId` | OWNER | Cascades members, files, versions |

### Members
| Method | Path | Min. role | Notes |
|---|---|---|---|
| GET | `/api/projects/:projectId/members` | VIEWER | Member list with user name/email |
| PATCH | `/api/projects/:projectId/members/:userId` | OWNER | Change role; **cannot change your own role (403)**; cannot demote the last OWNER |
| DELETE | `/api/projects/:projectId/members/:userId` | OWNER or self | The last OWNER cannot leave |

### Invitations v2 (Phase 4)
Phase 4 **replaced** Phase 2's direct-add semantics: creating an invitation
does NOT create a membership — the invitee becomes a member only by accepting
while signed in with the invited email address.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/projects/:projectId/invitations` | OWNER | `{email, role: EDITOR\|VIEWER}` → 201 PENDING invitation + `inviteUrl` (dev-mode link) + `invitedUserExists`. Works for registered **and** unregistered emails. Errors: already a member → 409 `CONFLICT`; a PENDING invite for the same (project, email) → 409 `DUPLICATE_INVITATION`; inviting your own email → 400 |
| GET | `/api/projects/:projectId/invitations` | OWNER | Newest first; optional `?status=` filter (PENDING/ACCEPTED/DECLINED/REVOKED/EXPIRED) |
| DELETE | `/api/projects/:projectId/invitations/:invitationId` | OWNER | Revoke — only PENDING → REVOKED, else 409; id outside the project → 404 |
| GET | `/api/invitations/:token` | public | Preview by raw token (looked up by SHA-256 hash): `{projectName, inviterName, role, status, expiresAt}` only — no emails or member lists. Unknown token → 404 |
| GET | `/api/invitations/mine` | session | PENDING, unexpired invitations addressed to the caller's email, with project/inviter names |
| POST | `/api/invitations/:token/accept` | session + CSRF | Email must match (403 `INVITATION_EMAIL_MISMATCH`); expired → 410 `INVITATION_EXPIRED`; settled → 409; already a member → 409. Transactionally creates the membership (invited role) and marks ACCEPTED; returns `{project}` summary |
| POST | `/api/invitations/:token/decline` | session + CSRF | Same gate; PENDING → DECLINED |
| POST | `/api/invitations/by-id/:invitationId/accept` · `/decline` | session + CSRF | Dashboard flow with identical rules, keyed by id: the raw token is never stored, so `GET /invitations/mine` cannot rebuild invite links for the signed-in invitee |

**Tokens & expiry.** Tokens are 32 random bytes; only their SHA-256 hash is
stored (`tokenHash @unique`). The raw token appears ONLY in the `inviteUrl`
of the create response and in the mailer. Invitations live `INVITATION_TTL_DAYS`
(default 7). Expiry is lazy: a PENDING invitation past `expiresAt` reads as
EXPIRED and is persisted as such on touch.

**Mailer configuration.** `src/lib/mailer.ts` defines a `Mailer` interface
with two implementations:

- `SMTP_HOST` unset → **DevMailer**: logs the invitation and the create
  response returns the `inviteUrl` so the flow works end-to-end in
  development (the web UI shows it as "Development mode — email delivery not
  configured" with a copy button).
- Production: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM` (or wire a provider such as Resend/SES behind the same
  interface). `SmtpMailer` validates that configuration at boot and fails
  loudly if it is incomplete; no SMTP transport library is bundled yet, so
  sending throws a clear "not configured" error rather than silently
  dropping mail. `APP_BASE_URL` (default `http://localhost:5173`) is the
  base for invite links: `${APP_BASE_URL}/invite/<rawToken>`.

### Chat (Phase 4)
| Method | Path | Min. role | Notes |
|---|---|---|---|
| GET | `/api/projects/:projectId/messages` | VIEWER | Cursor pagination, newest-first: `?limit=50` (1..100, default 50) and `?cursor=<messageId>` for the next older page; response `{messages, nextCursor}` with `sender {id, name, avatarUrl}` embedded. Unknown cursor → 400. Non-members → 404 |
| GET | `/api/projects/:projectId/presence` | VIEWER | `{online: [{userId, name, activeFileId, lastSeenAt}], members: [all members + role + online flag + activeFileId + lastSeenAt\|null]}` — DB roster merged with the live registry |

There is deliberately **no REST POST for messages** — sending happens over
the WebSocket gateway, which persists each message before broadcasting it.

**WebSocket protocol** — `ws(s)://<api-host>/api/chat/ws`, attached to the
same HTTP server/port as the REST API. Authentication is the `cc_access`
session cookie (browsers send it automatically; there is no token-in-URL
flow). An invalid/missing cookie rejects the upgrade with HTTP 401. All
frames are JSON; unknown types get an error frame.

| Direction | Frame | Meaning |
|---|---|---|
| client → | `{type:"subscribe", projectId}` | Membership is checked against the DB; failure → `{type:"error", code:"FORBIDDEN"}` and the socket closes (4403). Success → `{type:"subscribed", projectId}`, the user joins the room and presence is broadcast |
| client → | `{type:"message", projectId, content, clientMessageId?}` | Must be subscribed to that room. Content is trimmed and must be 1..2000 chars. The message is persisted, then broadcast to the whole room (sender included) as `{type:"message", message:{id, projectId, content, createdAt, sender:{id, name, avatarUrl}, clientMessageId?}` — the echo lets clients reconcile optimistic sends |
| client → | `{type:"presence", projectId, activeFileId: string\|null}` | Updates the sender's active file in the workspace presence registry and rebroadcasts presence |
| client → | `{type:"ping"}` | → `{type:"pong"}` |
| server → | `{type:"presence", projectId, users:[{userId, name, activeFileId, lastSeenAt}]}` | Sent on join, leave and presence changes |
| server → | `{type:"error", code, message}` | `FORBIDDEN`, `VALIDATION_ERROR`, `UNKNOWN_TYPE`, … |

The server heartbeats every 30s and terminates stale sockets; on close the
user leaves their rooms, `lastSeenAt` is recorded, and presence is
rebroadcast. **Any project member (OWNER/EDITOR/VIEWER) may read and send
chat** — chat is the workspace's social channel; document edit rights stay
governed by the existing role model.

**Presence registry** is in-memory and single-process
(`modules/chat/presence.ts`): per project, userId → `{name, activeFileId,
connectedAt, lastSeenAt}`, plus a retained last-seen map after disconnect.
It is intentionally separate from the Phase 3 Yjs Awareness (which is
document-level and stays in the editor header). A Redis-backed registry for
multi-instance deployments is future hardening work.

### Executions (Phase 5)
Code runs in the dedicated execution service (internal-only); the API is
its only caller. Full architecture, runner security model and limits:
**docs/execution.md**.

| Method | Path | Min. role | Notes |
|---|---|---|---|
| POST | `/api/projects/:projectId/executions` | EDITOR | Body `{entryFileId, files?: [{fileId, content?}]}`. Language is derived **server-side** from the entry file's extension (`.js/.mjs/.cjs` → javascript, `.py` → python, `.cpp/.cc/.cxx` → cpp; else 400 `UNSUPPORTED_LANGUAGE`). Submitted files must belong to the project; `content` (live editor state) is optional per file — omitted content loads the latest saved version. `files` omitted entirely → all project files (cap 50). The call **blocks until the run finishes** (bounded by the service timeout, ≤30 s) and returns 201 with the persisted execution. Per-user limits: 30 runs/hour (`RATE_LIMITED`), max 2 in flight (429 `TOO_MANY_RUNNING`). If the client disconnects mid-run, the execution is cancelled |
| GET | `/api/executions/:executionId` | creator only | Anyone else — including other project members — gets 404 |
| POST | `/api/executions/:executionId/cancel` | creator only | QUEUED/RUNNING → `CANCELLED` (the run is aborted in the execution service); already terminal → 409 `EXECUTION_NOT_RUNNING`; other users → 404 |

Execution DTO: `{id, projectId, userId, language, status, stdout, stderr,
exitCode, executionTimeMs, createdAt, updatedAt}` with
`status ∈ QUEUED | RUNNING | COMPLETED | FAILED | TIMEOUT | CANCELLED`.
stdout/stderr are capped at 64 KiB by the service (truncation marker
appended). If the execution service is unreachable, the run is recorded
`FAILED` with stderr `Execution service unavailable: …` — never a
fabricated success.

**Execution-disabled deployments (Phase 8):** when the API runs without
an execution backend (`EXECUTION_SERVICE_URL` unset/empty — the hosted
deployment's configuration, see docs/deployment.md), POST executions
returns **503 `EXECUTION_DISABLED`** ("Code execution is not enabled on
this deployment") and creates **no** execution record. GET/cancel of
existing records are unaffected.

### Files & versions
| Method | Path | Min. role | Notes |
|---|---|---|---|
| POST | `/api/projects/:projectId/files` | EDITOR | `{name, type: FILE\|FOLDER, parentId?, content?}`; path is computed server-side from the parent chain; names containing `/`, `\\`, `..` → 400 |
| GET | `/api/projects/:projectId/files` | VIEWER | Flat list with `parentId` (clients build the tree) |
| GET | `/api/files/:fileId` | VIEWER | A FILE includes its latest version's `content` |
| PATCH | `/api/files/:fileId` | EDITOR | Rename/move `{name?, parentId?}` (descendant paths rewritten) and/or `content` — a content change creates a new `DocumentVersion` in the same transaction |
| DELETE | `/api/files/:fileId` | EDITOR | Deleting a folder cascades to children and their versions |
| GET | `/api/files/:fileId/versions` | VIEWER | Version metadata, newest first — Phase 6 shape: `{id, fileId, createdBy, createdAt, source, label, author: {id, name}, sizeBytes}`; **content is never included in list responses** |
| GET | `/api/files/:fileId/versions/:versionId` | VIEWER | One version's metadata **with content**; a version from another file → 404 |
| POST | `/api/files/:fileId/versions` | EDITOR | Explicit save / snapshot: `{content, label?}` → new version. With a `label` the version is stored as `source: SNAPSHOT`; without one, `source: SAVE` (Phase 2 semantics) |
| POST | `/api/files/:fileId/versions/:versionId/restore` | EDITOR | Phase 6 restore: `{currentContent}` (the caller's live editor content). Snapshots `currentContent` first (`SNAPSHOT`, label `Before restore`), then applies the version **through the live document** via the collab server's internal endpoint — no DB-only overwrite. Collab unreachable → 502 `COLLAB_UNAVAILABLE`, document untouched. Returns `{restoredVersionId, snapshotVersionId}`. Full semantics: `docs/persistence.md` §5 |

Version `source` values (Phase 6): `SAVE` (explicit save / seeding),
`SNAPSHOT` (labelled snapshot + pre-restore snapshots), `AUTOSAVE`
(collaboration sync-back from the live document), `RESTORE` (reserved).

### Meta
| Method | Path | Notes |
|---|---|---|
| GET | `/health`, `/api/v1/health` | Phase 0 shape, not enveloped |
| GET | `/api/openapi.json` | OpenAPI 3 spec covering all endpoints above |
| GET | `/api/docs` | Swagger UI |
