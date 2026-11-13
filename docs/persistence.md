# Document persistence, autosave and version history (Phase 6)

How CollabCode keeps collaborative documents durable, how the editor's save
status works, what recovery is guaranteed, and how version history +
restore behave. Read `docs/architecture.md` for the system overview and
`docs/api.md` for endpoint details.

## 1. How persistence works

The serialized Yjs (CRDT) state in the `YjsDocument` table is the source of
truth for a live document — not the latest visible text. The collaboration
server's Hocuspocus Database extension calls:

- **fetch** when a document is loaded (returning the persisted state, or
  seeding once from the latest `DocumentVersion` if none exists yet), and
- **store** after changes, **debounced** (`STORE_DEBOUNCE_MS`, default
  2 s / `MAX_DEBOUNCE_MS`, default 10 s) — the database is never written
  per keystroke.

Each successful store also mirrors the plain text into `DocumentVersion`
history (source `AUTOSAVE`, throttled to ≥ `VERSION_SYNC_MIN_INTERVAL_MS`,
default 30 s per file, only when the text actually changed), authored by
the last observed editor (fallback: project owner).

### Retries, pending stores and the sweeper

Every fetch/store runs with a retry budget: `COLLAB_STORE_MAX_ATTEMPTS`
attempts (default 4) with exponential backoff (250 ms → 2 s). A store that
still fails is **parked** in an in-memory pending map — it is never dropped
silently:

- clients are told immediately (see §2),
- the entry keeps the live document reference, so a retry persists the
  **freshest** state, not a stale snapshot,
- a background **sweeper** (`COLLAB_STORE_SWEEP_MS`, default 5 s) retries
  every parked store until it lands,
- `GET /` on the health port (4003) exposes `pendingStores` for
  observability.

### Graceful shutdown flush

On `SIGTERM`/`SIGINT` (and on `destroy()` in tests) the server stops the
sweeper, force-stores **every loaded document immediately** — bypassing the
debounce — gives parked stores a final retry cycle, and only then closes
connections. A clean restart therefore loses nothing that reached the
server, even inside a debounce window.

## 2. Save status (persisted acknowledgements)

After a store lands, the server broadcasts a Hocuspocus **stateless
message** to the document's connected clients:

```json
{ "type": "persisted", "at": "2026-11-13T05:30:00.000Z" }
```

When a store exhausts its retry budget and is parked, it broadcasts
`{ "type": "persist-failed" }` instead (a later sweeper success sends
`persisted` again). The web client's `collabStore` turns these into the
header save-status chip:

| State | Chip | Meaning |
| --- | --- | --- |
| local edit, no ack yet | `Saving…` | edits exist that the server has not confirmed durable |
| `persisted` received | `Saved · HH:MM:SS` | the server confirmed the state is in PostgreSQL |
| `persist-failed` received | `Save failed — retrying` | the server is parked/retrying; **not** saved yet, stated honestly |
| edits while disconnected | `Offline — changes stored locally, will sync` | edits live in the local Y.Doc and sync on reconnect |
| no local edits this session | *(chip hidden)* | — |

Remote-origin updates never mark the document dirty; only the local
user's own edits drive `Saving…`.

## 3. Recovery guarantees

| Failure | Guarantee | Residual risk |
| --- | --- | --- |
| Browser refresh | Reconnect + fetch returns the last persisted state; edits made since the last successful store are re-synced from any still-connected peer, or lost if the tab was the only holder and closed before the debounce+store completed | Un-acked edits held only by a closing tab |
| Unexpected browser closure | Same as refresh — the server keeps serving/persisting for remaining peers | Same as above for a solo editor |
| Collaboration server restart (clean) | **No loss**: shutdown flush force-stores every loaded document before exit; on boot, fetch restores exact CRDT state (verified by tests) | None for a clean shutdown |
| Collaboration server **hard kill** (SIGKILL / crash) | Everything up to the last **successful store** is durable; clients that stay connected re-sync their Y.Docs on reconnect, re-persisting newer state | Up to one debounce interval (default ≤ 2–10 s) of edits that existed only in the killed process and in no connected client |
| API restart | No effect on documents: versions/files are plain PostgreSQL rows; restore calls fail 502 while the API is down, nothing is half-applied | None |
| Temporary network failure (client) | Local edits accumulate in the Y.Doc (`Offline — …` chip) and sync on reconnect; CRDT merge means concurrent edits are not lost | None beyond the outage window |
| Database connection interruption | Stores retry with backoff, then park; the sweeper lands them when the DB returns and clients get a fresh `persisted` ack (verified end-to-end by stopping/starting PostgreSQL mid-edit) | If the collab **process** dies while stores are parked, parked state survives only in connected clients' Y.Docs (see hard kill) |

**Acceptance statement:** no acknowledged and successfully persisted edit
disappears after a normal application or server restart. "Acknowledged"
means the `persisted` stateless ack (the `Saved` chip) — anything the UI
still shows as `Saving…` / `Save failed` / `Offline` is, by design, not
yet claimed durable.

## 4. Version history

`DocumentVersion` rows carry (Phase 6 migration
`phase6_version_source`):

- `source` — `SAVE` (explicit file save / project seeding), `SNAPSHOT`
  (user snapshot with an optional label, and the pre-restore snapshot),
  `AUTOSAVE` (collab sync-back from the live document), `RESTORE`
  (reserved bookkeeping value; restores themselves are versioned as
  AUTOSAVE by the sync-back — see §5),
- `label` — optional human label,
- author (resolved from `createdBy`), timestamp, and content size.

API list responses return metadata only (`source`, `label`, `author`,
`sizeBytes`, timestamps) — never the content; the single-version GET
returns the content. The web UI shows the list newest-first with source
badges (Save / Snapshot / Restore point / Autosave), supports creating a
labelled snapshot of the live content, and opens a Monaco **DiffEditor**
(original = selected version, modified = current live content).

## 5. Restore semantics

`POST /api/files/:fileId/versions/:versionId/restore` (EDITOR+), body
`{ currentContent }` = the caller's current live editor content:

1. File/version pairing is validated (a version from another file → 404).
2. **Pre-restore snapshot:** the caller's `currentContent` is stored as a
   `SNAPSHOT` labelled `Before restore`, authored by the caller — a
   restore is always reversible from history.
3. **Applied through the live document:** the API calls the collaboration
   server's internal endpoint
   (`POST /internal/documents/:documentName/restore` on port 4003, guarded
   by the `COLLAB_INTERNAL_TOKEN` shared secret, timing-safe compare).
   The collab server opens a **direct connection** and replaces the
   Y.Text inside a CRDT transaction (origin `restore`), so every
   connected editor converges through normal sync and persistence flows
   through the normal debounced store. There is **no DB-only overwrite**
   path — it does not exist.
4. If the collab server is unreachable or refuses, the API returns
   **502 `COLLAB_UNAVAILABLE`** and the document is untouched. The
   pre-restore snapshot from step 2 remains in history (harmless and
   honest); no restore is recorded.
5. No separate restore version row is written by the API: the collab
   sync-back versions the restored state as `AUTOSAVE`, exactly like any
   other live edit. The response is
   `{ restoredVersionId, snapshotVersionId }`.

The UI never sets editor content locally on restore — the change arrives
via collaboration sync, keeping every client (including the restorer's)
on the same CRDT state.

## 6. Configuration

| Env | Service | Default | Meaning |
| --- | --- | --- | --- |
| `COLLAB_STORE_MAX_ATTEMPTS` | collaboration | 4 | fetch/store retry budget before parking |
| `COLLAB_STORE_SWEEP_MS` | collaboration | 5000 | pending-store sweeper interval |
| `COLLAB_INTERNAL_TOKEN` | collaboration + API | dev default outside production | shared secret for the internal restore endpoint; ≥16 chars enforced in production on both sides |
| `COLLAB_INTERNAL_URL` | API | `http://localhost:4003` | where the API reaches the collab internal endpoint |
| `STORE_DEBOUNCE_MS` / `MAX_DEBOUNCE_MS` | collaboration | 2000 / 10000 | store debounce window |
| `VERSION_SYNC_MIN_INTERVAL_MS` | collaboration | 30000 | AUTOSAVE version throttle per file |
