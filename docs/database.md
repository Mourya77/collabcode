# Database design

PostgreSQL via Prisma (`apps/api/prisma/schema.prisma` is canonical; the collaboration service generates a deliberate subset client from `apps/collaboration/prisma/schema.prisma`). All PKs are UUIDs (`@default(uuid())`).

| Model | Key fields | Relations / rules |
|---|---|---|
| User | name, email `@unique`, passwordHash (Argon2id), avatarUrl?, createdAt, updatedAt | owns Projects, ProjectMembers, DocumentVersions (createdBy), ChatMessages, Executions, RefreshTokens, Invitations sent |
| RefreshToken | userId FK, tokenHash `@unique` (SHA-256 of the opaque cookie value — the raw token is never stored), expiresAt, revokedAt? | rotation on every refresh; reuse of a revoked token revokes ALL of the user's tokens (Phase 2) |
| Project | name, description?, ownerId FK | owner → User `onDelete: Cascade`; `@@index([ownerId])` |
| ProjectMember | projectId, userId, role enum `OWNER/EDITOR/VIEWER` default VIEWER | `@@unique([projectId, userId])`; both FKs cascade; the last OWNER cannot be removed/demoted |
| Invitation (Phase 4) | projectId, email, role, invitedById FK, tokenHash `@unique` (SHA-256 of a 32-byte token), status enum `PENDING/ACCEPTED/REVOKED/EXPIRED`, expiresAt (7 days) | lazy expiry on touch; acceptance requires the account email to match the invited email and runs in a transaction creating the ProjectMember row |
| File | projectId, parentId? self-FK (`FileTree`), name, type enum `FILE/FOLDER`, path | `@@unique([projectId, path])`, `@@index([projectId, parentId])`; cascades; path traversal rejected at the API |
| DocumentVersion | fileId, createdBy FK → User, content `@db.Text`, **source** (`SAVE` / `SNAPSHOT` / `AUTOSAVE`, Phase 6), **label?** (user label for snapshots) | file + creator cascade; `@@index([fileId, createdAt])`; restore never overwrites — it takes a pre-restore snapshot, then applies through the live Y.Doc (docs/persistence.md) |
| YjsDocument (Phase 3) | fileId `@unique` FK → File, state `Bytes`, createdAt, updatedAt | one persisted Yjs state per file, written by the collaboration server; plain text is synced back into DocumentVersion by the collab server, throttled (docs/collaboration.md) |
| ChatMessage | projectId, senderId, content `@db.Text` | both FKs cascade; `@@index([projectId, createdAt])`; history paginated by (createdAt, id) cursor |
| Execution | projectId, userId, language, status enum `QUEUED/RUNNING/COMPLETED/FAILED/TIMEOUT/CANCELLED`, stdout?/stderr? `@db.Text`, exitCode?, executionTime? (ms) | both FKs cascade; indexes on projectId, userId, status (+ Phase 7 composite indexes); records are visible only to the user who ran them |

## Migrations

Prisma Migrate, applied automatically at boot of a deployed API (`prisma migrate deploy` in the Render start command):

| Migration | Phase |
|---|---|
| `20261111164129_phase2_init` | 2 — users, projects, members, files, versions, chat, executions, refresh tokens |
| `20261112044725_phase3_yjs_documents` | 3 — YjsDocument |
| `20261112131447_phase4_invitations` | 4 — Invitation |
| `20261112134943_phase5_execution_cancelled` | 5 — Execution `CANCELLED` status |
| `20261113053148_phase6_version_source` | 6 — DocumentVersion `source` + `label` |
| `20261113063229_phase7_indexes` | 7 — hot-path indexes from the QA pass |
