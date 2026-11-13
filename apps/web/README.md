# @collabcode/web

React 18 + TypeScript + Vite 6 + Tailwind CSS v4 (`@tailwindcss/vite`) + Zustand 5 +
React Router 7 + Monaco (`@monaco-editor/react`) + Radix UI primitives (Dialog, Dropdown Menu).
Dark-first developer UI (zinc + single sky accent), shadcn-style component setup
(`components.json`, `src/lib/utils.ts` `cn`, `src/components/ui/*`).

## Run

```bash
pnpm --filter @collabcode/web dev       # http://localhost:5173
pnpm --filter @collabcode/web build     # typecheck + production build
pnpm --filter @collabcode/web test      # vitest + Testing Library
pnpm --filter @collabcode/web preview   # serves the production build (SPA fallback on)
```

Dev proxy: `/api` → `http://localhost:4000`. `VITE_API_URL` (see `.env.example`) sets the
API origin used by the health check. Production deploy target: Vercel
(see `docker/web.Dockerfile` for a container alternative).

## Routes

| Route | Page | Guard |
|---|---|---|
| `/` | Landing — hero, features, how collaboration works, tech highlights, live API health (`ServiceStatus`) | public |
| `/login`, `/register` | Auth forms (validation, password visibility toggle, loading + error states) | redirect to `/dashboard` if signed in |
| `/dashboard` | Sidebar + navbar layout, welcome, "Invitations for you" (Phase 4), project search, project cards, create-project modal, empty state | protected |
| `/invite/:token` | Public invitation landing page (Phase 4): preview, login/register return path, accept/decline | public |
| `/workspace/:projectId` | IDE: activity bar, file explorer, Monaco tabs/editor, resizable bottom panel (Terminal/Output/Problems), collaboration/chat right panel | protected |
| `/settings` | Profile (display name), appearance (theme + editor font size, persisted), account info | protected |
| `*` | NotFound | — |

Protected routes use `src/components/ProtectedRoute.tsx`, which redirects to `/login`
and preserves the intended path.

## State (Zustand, one store per concern)

- `stores/authStore.ts` — current user, bootstrapped flag, login/register/logout/
  updateProfile. Talks to the real API via `src/lib/api/auth.ts`; the session itself
  lives in server-set httpOnly cookies (nothing auth-related in localStorage).
- `stores/projectStore.ts` — server-backed projects/files/members: dashboard list
  (server-side search + pagination), workspace loading, file create/delete, debounced
  version saves, invitations. The explorer tree is built from the API's flat file list.
- `stores/editorStore.ts` — open tabs, active file, per-file contents, dirty/saved status,
  language overrides, editor font size (persisted).
- `stores/chatStore.ts` — Phase 4 chat: connection status, per-project messages
  (REST history merged with live WS frames, optimistic sends reconciled by
  clientMessageId), per-project workspace presence.
- `stores/workspaceStore.ts` — activity panel, expanded folders, file search, bottom/right
  panel tabs.
- `stores/executionStore.ts` — Phase 5 execution: run phase, last execution
  (stdout/stderr/exit/duration), error and cancel state for the Output panel.
- `stores/uiStore.ts` — theme, API health status, sidebar collapse, bottom-panel size,
  right-panel visibility (UI prefs persisted as `collabcode.ui`).

Autosave: editing marks files dirty; after ~800 ms idle each dirty file is saved to
the API as a new DocumentVersion (`POST /api/files/:id/versions`) and the header
shows “Saved”. VIEWERs get a read-only editor and a “View-only access” banner.

## API integration (Phase 2)

The Phase 1 dev auth adapter is **deleted**. All data comes from `@collabcode/api`:

- `src/lib/api/client.ts` — fetch wrapper: `credentials: "include"`, envelope
  unwrapping, `ApiClientError` with the server's error code, CSRF double-submit
  (reads the `cc_csrf` cookie; bootstraps it via `GET /api/auth/csrf` when absent),
  and exactly one `POST /api/auth/refresh` + retry on a 401 (never for
  login/register/refresh themselves).
- `src/lib/api/{auth,projects,files,collab,invitations,chat}.ts` — typed endpoint modules.
- `authStore.bootstrap()` runs once at app start (`GET /api/auth/me`) so sessions
  survive reloads via cookies; it also removes the Phase 1 localStorage keys
  (`collabcode.dev.users`, `collabcode.dev.session`, `collabcode.projects`,
  `collabcode.editor`) exactly once.
- Base URL: `VITE_API_URL` if set, otherwise same-origin — the Vite dev server
  **and** preview proxy `/api` → `http://localhost:4000`, which keeps cookies
  first-party in development.

## Real-time collaboration (Phase 3)

Opening a file starts a live session (`src/stores/collabStore.ts` +
`src/lib/collab/*`):

- `lib/api/collab.ts` fetches a 10-minute collab token from
  `POST /api/collab/token`; `lib/collab/provider.ts` creates the Y.Doc +
  HocuspocusProvider with an **async token function**, so every reconnect
  re-fetches a fresh token.
- The editor's content source is the session's `Y.Text("content")`, bound to
  Monaco with y-monaco (`MonacoBinding`, lazy-loaded). The Phase 2 REST save
  debounce is disabled for collaborative files — the collaboration server
  persists Yjs state and syncs `DocumentVersion`s. A Y.Text observer mirrors
  content into `editorStore` so the Problems panel keeps working.
- Presence: awareness field `user {id, name, color}`; colours are a stable
  FNV-1a hash of the user id over an 8-colour palette (`lib/collab/colors.ts`).
  Remote cursor/selection CSS is generated per awareness client id
  (`lib/collab/cursorStyles.ts`) and injected by the workspace; live users
  appear in the header avatars and the right panel, and disappear on
  disconnect via awareness change events.
- The header chip is honest about state: Connecting / Live — Synced /
  Reconnecting… — changes stored locally / Offline — changes stored locally.
  There is no silent fallback: offline edits live in the local Y.Doc and
  sync when the provider reconnects.
- **Save status (Phase 6):** a second header chip is driven by the
  server's persistence acknowledgements (stateless messages), never by
  guessing: Saving… → Saved · HH:MM:SS on the `persisted` ack;
  `Save failed — retrying` on `persist-failed`; `Offline — changes stored
  locally, will sync` for edits made while disconnected. Remote-origin
  updates never mark the document dirty.
- **Version history (Phase 6):** the header **History** button opens the
  version panel for the active file — newest-first list with timestamps,
  authors, source badges (Save / Snapshot / Restore point / Autosave) and
  labels; EDITOR+ can create a labelled snapshot of the live content and
  restore a version (behind a confirmation explaining that the current
  content is snapshotted first and the restore replaces the document for
  everyone, live); anyone can open a Monaco DiffEditor (version vs current
  live content). Restores arrive through collab sync — the editor content
  is never set locally. See `../../docs/persistence.md`.
  merge on reconnect (that is the CRDT design).
- Server URL: `VITE_COLLAB_URL` (default `ws://localhost:4001`).
- Switching files or leaving the workspace disposes binding, provider and
  document — no leaked listeners.

## Chat, invitations & workspace presence (Phase 4)

- **Chat** is real: `src/lib/chat/chatClient.ts` opens a WebSocket to
  `/api/chat/ws` (cookie auth — the Vite dev/preview proxy forwards `/api`
  with `ws: true`), subscribes to the workspace room and reconnects with
  backoff. `chatStore` merges REST history (cursor pagination, "Load older")
  with live frames; sends are optimistic and reconciled by `clientMessageId`
  when the server echo arrives, so nothing renders twice. The panel shows an
  honest connection chip and disables sending while disconnected.
- **Workspace presence** (right panel "Workspace" section) comes from the
  chat gateway: who is connected, which file they have open, and last-active
  times for offline members. It is a different system from the Phase 3
  document awareness in the editor header — both are shown, labelled by
  scope.
- **Invitations v2:** the Invite modal creates a PENDING invitation and, in
  development (no email configured), shows the invite link with a copy
  button. The Members modal manages roles and invitation states (revoke).
  `/invite/:token` is the public landing page (preview → log in/register
  with return path → accept/decline); the dashboard lists "Invitations for
  you" and answers them by id (raw tokens are never stored server-side).

## Honesty notes

- The collaboration panel lists the project's **real members** (from the API)
  plus **live presence** from Yjs awareness (Phase 3) and the chat gateway
  (Phase 4) — nobody is shown as present unless their client is actually connected.
- **Run** (Phase 5) really executes the active file in the isolated execution
  service via the API, and the Output panel shows the captured stdout/stderr
  with an exit-code/duration/status footer. It is labelled as captured
  program output — **not** an interactive terminal; the Terminal panel stays
  an honest, non-connected placeholder for an interactive shell, which
  CollabCode does not have.
- Source control is a labelled placeholder (Git integration is out of scope for this phase).
- Monaco loads via `@monaco-editor/react`'s default loader (CDN) at runtime, while
  y-monaco bundles the editor API into a lazy ~2.7 MB chunk (self-hosting + dedupe
  is a future hardening phase); `vite.config.ts` aliases y-monaco's legacy monaco import path for
  monaco-editor 0.57's exports map. Unit tests
  stub it with a textarea because Monaco cannot run in jsdom.
