import * as Y from "yjs";
import type { Doc } from "yjs";
import { parseDocumentName } from "./documentName.js";

/**
 * Yjs document persistence (Phase 3, hardened in Phase 6).
 *
 * Storage model: the serialized Yjs state (Bytes) in the `YjsDocument` table
 * is the source of truth for a live document — NOT the latest visible text.
 * The Hocuspocus Database extension calls fetch() when a document loads and
 * store() after changes, debounced by the server configuration
 * (STORE_DEBOUNCE_MS / MAX_DEBOUNCE_MS), so the database is never written on
 * every keystroke.
 *
 * Durability (Phase 6):
 * - Every fetch/store is retried with exponential backoff
 *   (COLLAB_STORE_MAX_ATTEMPTS attempts, 250 ms → 2 s) so a brief database
 *   blip never loses an acknowledged edit.
 * - A store that still fails is PARKED in an in-memory pending map — never
 *   dropped. The server's sweeper calls retryPending() every
 *   COLLAB_STORE_SWEEP_MS until it lands, and shutdown flushes via
 *   storeNow(). The pending entry keeps the live document reference, so a
 *   retry persists the FRESHEST state, not a stale snapshot.
 * - Clients are told the truth via stateless messages (wired in server.ts):
 *   `persisted` after a successful store, `persist-failed` after the retry
 *   budget is exhausted (a later sweeper success sends `persisted` again).
 *   Residual risk, stated plainly: if the collaboration PROCESS is
 *   hard-killed while a store is parked pending, edits since the last
 *   successful store exist only in connected clients' Y.Docs and re-sync
 *   when those clients reconnect. See docs/persistence.md.
 *
 * Plain-text sync: each store() also mirrors the document text into the REST
 * world as a DocumentVersion (source AUTOSAVE) — but only when the text
 * actually changed and at most once per VERSION_SYNC_MIN_INTERVAL_MS per
 * file (in-memory throttle), so version history stays meaningful instead of
 * per-keystroke. The version author is the last authenticated user observed
 * editing the document (onChange), falling back to the project owner.
 */

export interface PersistenceDb {
  yjsDocument: {
    findUnique(args: { where: { fileId: string } }): Promise<{ state: Uint8Array } | null>;
    upsert(args: {
      where: { fileId: string };
      create: { fileId: string; state: Buffer };
      update: { state: Buffer };
    }): Promise<unknown>;
  };
  documentVersion: {
    findFirst(args: {
      where: { fileId: string };
      orderBy: { createdAt: "desc" };
    }): Promise<{ content: string } | null>;
    create(args: {
      data: { fileId: string; createdBy: string; content: string; source: string };
    }): Promise<unknown>;
  };
  project: {
    findUnique(args: { where: { id: string } }): Promise<{ ownerId: string } | null>;
  };
}

export type PersistenceLog = (event: string, data?: Record<string, unknown>) => void;

export interface PersistenceHooks {
  /** Called after a store for the document has durably landed in the database. */
  onPersisted?: (documentName: string, at: Date) => void;
  /** Called when a store exhausted its retry budget and was parked as pending. */
  onPersistFailed?: (documentName: string) => void;
}

export interface Persistence {
  /** Database extension fetch: persisted Yjs state for the document, or null. */
  fetch(data: { documentName: string }): Promise<Uint8Array | null>;
  /** Database extension store: upsert state + throttled DocumentVersion sync. */
  store(data: { documentName: string; state: Uint8Array; document: Doc }): Promise<void>;
  /**
   * Immediate store with the full retry budget (graceful-shutdown flush and
   * sweeper use). Resolves true when the state is durable.
   */
  storeNow(data: { documentName: string; state: Uint8Array; document: Doc }): Promise<boolean>;
  /** Retries every parked pending store once; resolves how many landed. */
  retryPending(): Promise<number>;
  /** How many documents currently have a parked (not yet durable) store. */
  pendingCount(): number;
  /**
   * onLoadDocument seeding: when NO persisted Yjs state exists yet, seed the
   * shared text from the latest DocumentVersion exactly once. Returns true
   * when seeding happened. Persisted state existing ⇒ never re-seeds, so
   * content can never be duplicated by reloads.
   */
  seedIfNeeded(document: Doc, documentName: string): Promise<boolean>;
  /** Records the latest authenticated editor of a document (from onChange). */
  noteEditor(documentName: string, userId: string): void;
  /** The current plain text persisted for a file (latest version), if any. */
  latestVersionText(fileId: string): Promise<string | null>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createPersistence(
  db: PersistenceDb,
  options: {
    versionSyncMinIntervalMs: number;
    log?: PersistenceLog;
    storeMaxAttempts?: number;
    storeBaseDelayMs?: number;
    storeMaxDelayMs?: number;
    hooks?: PersistenceHooks;
  },
): Persistence {
  const lastEditors = new Map<string, string>();
  const lastVersionSyncAt = new Map<string, number>();
  const pending = new Map<string, { state: Uint8Array; document: Doc }>();
  const log: PersistenceLog = options.log ?? (() => undefined);
  const maxAttempts = options.storeMaxAttempts ?? 4;
  const baseDelayMs = options.storeBaseDelayMs ?? 250;
  const maxDelayMs = options.storeMaxDelayMs ?? 2000;

  async function latestVersionText(fileId: string): Promise<string | null> {
    const latest = await db.documentVersion.findFirst({
      where: { fileId },
      orderBy: { createdAt: "desc" },
    });
    return latest?.content ?? null;
  }

  /** Runs `fn` with exponential backoff; rethrows the last error when the budget is spent. */
  async function withRetry<T>(label: string, documentName: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        log("store.retry", {
          documentName,
          operation: label,
          attempt,
          maxAttempts,
          error: e instanceof Error ? e.message : String(e),
        });
        if (attempt < maxAttempts) {
          await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
        }
      }
    }
    throw lastError;
  }

  /** Throttled AUTOSAVE DocumentVersion mirror. Failures never fail the store. */
  async function syncVersion(documentName: string, projectId: string, fileId: string, document: Doc): Promise<void> {
    try {
      const now = Date.now();
      if (now - (lastVersionSyncAt.get(fileId) ?? 0) < options.versionSyncMinIntervalMs) return;
      const text = document.getText("content").toString();
      const latest = await latestVersionText(fileId);
      if (latest === text) {
        lastVersionSyncAt.set(fileId, now);
        return;
      }
      if (latest === null && text === "") return; // nothing worth versioning yet
      let createdBy = lastEditors.get(documentName);
      if (!createdBy) {
        const project = await db.project.findUnique({ where: { id: projectId } });
        createdBy = project?.ownerId;
      }
      if (!createdBy) return;
      await db.documentVersion.create({ data: { fileId, createdBy, content: text, source: "AUTOSAVE" } });
      lastVersionSyncAt.set(fileId, now);
      log("version.synced", { documentName, fileId, createdBy });
    } catch (e) {
      log("version.sync_failed", { documentName, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * One durable-store attempt cycle for a document. Returns true when the
   * state landed (or the file is gone — nothing left to persist into).
   */
  async function attemptStore(documentName: string, state: Uint8Array, document: Doc): Promise<boolean> {
    const { projectId, fileId } = parseDocumentName(documentName);
    try {
      await withRetry("upsert", documentName, () =>
        db.yjsDocument.upsert({
          where: { fileId },
          create: { fileId, state: Buffer.from(state) },
          update: { state: Buffer.from(state) },
        }),
      );
    } catch (e) {
      // The file was deleted (REST) while a debounced store was pending:
      // its document is gone, so there is nothing to persist into. Any
      // other error is real and must surface.
      if ((e as { code?: string }).code === "P2003") {
        log("store.skipped_file_deleted", { documentName, fileId });
        return true;
      }
      log("store.failed", {
        documentName,
        fileId,
        attempts: maxAttempts,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
    await syncVersion(documentName, projectId, fileId, document);
    return true;
  }

  async function storeNow(data: { documentName: string; state: Uint8Array; document: Doc }): Promise<boolean> {
    const ok = await attemptStore(data.documentName, data.state, data.document);
    if (ok) {
      pending.delete(data.documentName);
      options.hooks?.onPersisted?.(data.documentName, new Date());
    }
    return ok;
  }

  return {
    noteEditor(documentName, userId) {
      lastEditors.set(documentName, userId);
    },

    latestVersionText,

    pendingCount() {
      return pending.size;
    },

    storeNow,

    async retryPending() {
      let landed = 0;
      for (const [documentName, entry] of [...pending.entries()]) {
        // Persist the FRESHEST state: re-encode from the live document when
        // it is still loaded (it is the same object the server broadcasts).
        let state = entry.state;
        try {
          state = Y.encodeStateAsUpdate(entry.document);
        } catch {
          /* document destroyed — fall back to the parked bytes */
        }
        if (await storeNow({ documentName, state, document: entry.document })) landed += 1;
      }
      return landed;
    },

    async fetch({ documentName }) {
      let fileId: string;
      try {
        fileId = parseDocumentName(documentName).fileId;
      } catch {
        return null;
      }
      const row = await withRetry("fetch", documentName, () => db.yjsDocument.findUnique({ where: { fileId } }));
      return row ? new Uint8Array(row.state) : null;
    },

    async store({ documentName, state, document }) {
      if (await storeNow({ documentName, state, document })) return;
      // Retry budget exhausted: park it — the sweeper keeps retrying and a
      // later success re-notifies clients. Never drop it silently.
      pending.set(documentName, { state, document });
      log("store.pending", { documentName, pendingCount: pending.size });
      options.hooks?.onPersistFailed?.(documentName);
    },

    async seedIfNeeded(document, documentName) {
      let fileId: string;
      try {
        fileId = parseDocumentName(documentName).fileId;
      } catch {
        return false;
      }
      const existing = await db.yjsDocument.findUnique({ where: { fileId } });
      if (existing) return false; // persisted CRDT state wins — never re-seed
      const ytext = document.getText("content");
      if (ytext.length > 0) return false; // already has content (e.g. a peer's state)
      const content = await latestVersionText(fileId);
      if (!content) return false;
      ytext.insert(0, content);
      return true;
    },
  };
}
