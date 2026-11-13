import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import * as Y from "yjs";
import { Server, type Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { makeHealth } from "@collabcode/shared";
import { collabInternalToken, collabSecret, env as defaultEnv, type Env } from "./config/env.js";
import { authorizeDocument, CollabAuthError } from "./auth.js";
import { parseDocumentName } from "./documentName.js";
import { createPersistence, type Persistence } from "./persistence.js";
import { disconnectPrisma, getPrisma } from "./prisma.js";

/**
 * CollabCode collaboration server (Phase 3, persistence hardened in Phase 6).
 *
 * A Hocuspocus (Yjs CRDT) WebSocket server. Every document is named
 * `project:<projectId>:file:<fileId>` and is authorized per connection:
 * the collab JWT is verified AND membership/file consistency is checked
 * against the database in onAuthenticate — document names are never
 * trusted. VIEWER connections are flagged readOnly, and Hocuspocus then
 * refuses their document updates server-side.
 *
 * Persistence is provided by the Database extension backed by the
 * YjsDocument table (debounced — never per keystroke), with retries,
 * a pending-store sweeper, a shutdown flush, persisted acknowledgements
 * to clients, and a throttled plain-text sync into DocumentVersion
 * (see persistence.ts and docs/persistence.md).
 *
 * The HTTP server on the health port also hosts the INTERNAL restore
 * endpoint used by the API (Phase 6 version restore). It is guarded by
 * the COLLAB_INTERNAL_TOKEN shared secret and is not a public API.
 *
 * Phase 8 — single-port mode (SINGLE_PORT / production + PORT): hosts like
 * Render expose exactly one port per service, so /health and the restore
 * endpoint are then served by the Hocuspocus HTTP server on the WS port
 * (via the onRequest hook) and no separate health listener is started.
 */

export interface CollabServerOptions {
  port?: number;
  healthPort?: number;
  /** Explicit collab JWT secret (defaults to COLLAB_JWT_SECRET ?? JWT_SECRET from env). */
  secret?: string;
  /** Explicit DATABASE_URL for this instance's Prisma client. */
  databaseUrl?: string;
  storeDebounceMs?: number;
  maxDebounceMs?: number;
  versionSyncMinIntervalMs?: number;
  /** Phase 6: retry budget per store/fetch before a store is parked as pending. */
  storeMaxAttempts?: number;
  /** Phase 6: pending-store sweeper interval (ms). */
  storeSweepMs?: number;
  /** Phase 6: explicit internal-endpoint token (defaults to COLLAB_INTERNAL_TOKEN from env). */
  internalToken?: string;
  /** Phase 7: browser origins allowed to connect (defaults to ALLOWED_ORIGINS from env). */
  allowedOrigins?: string[];
  /**
   * Phase 8: single-port mode — the WS port also serves /health and the
   * internal restore endpoint (for hosts like Render that expose exactly
   * one port). Defaults to env SINGLE_PORT_MODE.
   */
  singlePort?: boolean;
  quiet?: boolean;
}

export interface CollabServerHandle {
  hocuspocus: Hocuspocus;
  healthServer: HttpServer;
  persistence: Persistence;
  port: number;
  healthPort: number;
  singlePort: boolean;
  listen(): Promise<void>;
  destroy(): Promise<void>;
}

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", service: "collaboration", event, ...data }));
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCollaborationServer(options: CollabServerOptions = {}, envSource: Env = defaultEnv): CollabServerHandle {
  const port = options.port ?? envSource.PORT;
  const healthPort = options.healthPort ?? envSource.HEALTH_PORT;
  const singlePort = options.singlePort ?? envSource.SINGLE_PORT_MODE;
  const secret = options.secret ?? collabSecret(envSource);
  const internalToken = options.internalToken ?? collabInternalToken(envSource);
  const prisma = getPrisma(options.databaseUrl);

  // Late-bound stateless notifier: persistence is created before the
  // Hocuspocus instance, so the broadcast hooks resolve the instance here.
  let hocuspocusRef: Hocuspocus | null = null;
  const broadcast = (documentName: string, payload: Record<string, unknown>): void => {
    try {
      hocuspocusRef?.documents.get(documentName)?.broadcastStateless(JSON.stringify(payload));
    } catch (e) {
      log("stateless.broadcast_failed", { documentName, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Thin adapters over the generated Prisma client: they keep the
  // persistence layer's structural types decoupled from Prisma's generics
  // (and normalise Bytes inputs to fresh ArrayBuffer-backed Uint8Arrays).
  const persistence = createPersistence(
    {
      yjsDocument: {
        findUnique: (args) => prisma.yjsDocument.findUnique(args),
        upsert: (args) =>
          prisma.yjsDocument.upsert({
            where: args.where,
            create: { fileId: args.create.fileId, state: new Uint8Array(args.create.state) },
            update: { state: new Uint8Array(args.update.state) },
          }),
      },
      documentVersion: {
        findFirst: (args) => prisma.documentVersion.findFirst(args),
        create: (args) => prisma.documentVersion.create(args),
      },
      project: {
        findUnique: (args) => prisma.project.findUnique({ where: args.where, select: { ownerId: true } }),
      },
    },
    {
      versionSyncMinIntervalMs: options.versionSyncMinIntervalMs ?? envSource.VERSION_SYNC_MIN_INTERVAL_MS,
      storeMaxAttempts: options.storeMaxAttempts ?? envSource.COLLAB_STORE_MAX_ATTEMPTS,
      log,
      hooks: {
        onPersisted: (documentName, at) => broadcast(documentName, { type: "persisted", at: at.toISOString() }),
        onPersistFailed: (documentName) => broadcast(documentName, { type: "persist-failed" }),
      },
    },
  );

  const hocuspocus = Server.configure({
    port,
    quiet: options.quiet ?? true,
    stopOnSignals: false,
    debounce: options.storeDebounceMs ?? envSource.STORE_DEBOUNCE_MS,
    maxDebounce: options.maxDebounceMs ?? envSource.MAX_DEBOUNCE_MS,
    extensions: [
      new Database({
        fetch: persistence.fetch,
        // The extension passes the full store payload (including the live
        // document), which the plain-text version sync needs.
        store: async (data) => {
          await persistence.store({
            documentName: data.documentName,
            state: data.state,
            document: data.document,
          });
        },
      }),
    ],

    onUpgrade(data) {
      // Cross-site WebSocket hijacking guard (Phase 7), layer 1 — at the
      // HTTP upgrade, before any WebSocket exists: collab tokens are bearer
      // credentials, so a browser page from a foreign origin must never be
      // able to open this socket. Requests without an Origin header are not
      // browsers (native clients, tests) and pass through to token auth.
      const origin = data.request.headers.origin;
      const allowedOrigins = options.allowedOrigins ?? envSource.ALLOWED_ORIGINS_LIST;
      if (origin && !allowedOrigins.includes(origin)) {
        log("ws.origin_rejected", { origin });
        data.socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        data.socket.destroy();
        // Hocuspocus convention: a FALSY hook rejection means "handled —
        // do not upgrade". Rejecting with an Error here would escape as an
        // unhandled rejection inside Hocuspocus's upgrade listener.
        return Promise.reject();
      }
      return Promise.resolve();
    },

    // Phase 8 — single-port mode only: Render exposes ONE port per service,
    // so the platform HTTP surface (GET /health + the token-guarded internal
    // restore endpoint) is served by the Hocuspocus HTTP server itself, on
    // the WS port. When the platform handler has written the response, the
    // hook rejects with a falsy value — Hocuspocus's convention for
    // "handled, skip the default OK response" (same as onUpgrade above).
    ...(singlePort
      ? {
          async onRequest(data: { request: IncomingMessage; response: ServerResponse }) {
            const handled = await handlePlatformHttp(data.request, data.response, false);
            if (handled) return Promise.reject();
          },
        }
      : {}),

    async onConnect(data) {
      // Layer 2 (defence in depth): onConnect fires on the client's first
      // message — repeat the Origin check in case a proxy ever strips or
      // rewrites the upgrade request.
      const origin = data.requestHeaders.origin;
      const allowedOrigins = options.allowedOrigins ?? envSource.ALLOWED_ORIGINS_LIST;
      if (origin && !allowedOrigins.includes(origin)) {
        log("ws.origin_rejected", { documentName: data.documentName, origin });
        throw new Error("Origin not allowed");
      }
      log("ws.connect", { documentName: data.documentName, socketId: data.socketId });
    },

    async onAuthenticate(data) {
      try {
        const identity = await authorizeDocument(prisma, data.token, data.documentName, secret);
        // Hocuspocus enforces readOnly connections server-side: their sync
        // updates are rejected and never applied or broadcast.
        data.connection.readOnly = identity.readOnly;
        log("ws.authenticated", {
          documentName: data.documentName,
          userId: identity.userId,
          role: identity.role,
          readOnly: identity.readOnly,
        });
        return { user: { id: identity.userId, name: identity.name, role: identity.role } };
      } catch (e) {
        log("ws.auth_rejected", {
          documentName: data.documentName,
          reason: e instanceof Error ? e.message : String(e),
        });
        throw e instanceof CollabAuthError ? e : new Error("Unauthorized");
      }
    },

    async onLoadDocument(data) {
      // Seed from the latest DocumentVersion only when no Yjs state has
      // ever been persisted for this file (exactly-once; see persistence).
      const seeded = await persistence.seedIfNeeded(data.document, data.documentName);
      log("document.loaded", { documentName: data.documentName, seeded });
    },

    async onChange(data) {
      // hookPayload.context is the *editing* connection's context, so this
      // tracks the real last editor for DocumentVersion attribution.
      const user = (data.context as { user?: { id?: unknown } } | undefined)?.user;
      if (user && typeof user.id === "string") persistence.noteEditor(data.documentName, user.id);
    },

    async onDisconnect(data) {
      log("ws.disconnect", { documentName: data.documentName, clientsCount: data.clientsCount });
    },
  });
  hocuspocusRef = hocuspocus;

  /**
   * Phase 6 — internal restore: replace a live document's text with the
   * given content THROUGH the CRDT (a transact on the shared Y.Text), so
   * every connected editor converges via normal sync and persistence flows
   * through the normal debounced store. Never a DB-only overwrite.
   */
  async function handleRestore(documentName: string, content: string): Promise<void> {
    parseDocumentName(documentName); // throws on malformed names → 400
    const connection = await hocuspocus.openDirectConnection(documentName, { internal: "restore" });
    try {
      await connection.transact((document) => {
        const text = document.getText("content");
        if (text.toString() === content) return;
        text.delete(0, text.length);
        if (content.length > 0) text.insert(0, content);
      }, "restore");
    } finally {
      await connection.disconnect();
    }
    log("document.restored", { documentName, bytes: content.length });
  }

  /**
   * The platform HTTP surface: the health payload and the internal restore
   * endpoint. Served by the standalone health server in dual-port mode and
   * by the Hocuspocus HTTP server (via onRequest) in single-port mode.
   * Returns true when the request was handled and the response is final.
   * `healthOnAnyPath` preserves the standalone health server's historical
   * behaviour (health JSON on every path); on the WS port only /health is
   * claimed and everything else falls through to Hocuspocus.
   */
  async function handlePlatformHttp(req: IncomingMessage, res: ServerResponse, healthOnAnyPath: boolean): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const restoreMatch = /^\/internal\/documents\/(.+)\/restore$/.exec(url.pathname);
    if (req.method === "POST" && restoreMatch) {
      const send = (status: number, body: Record<string, unknown>) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (!tokenMatches(req.headers["x-internal-token"] as string | undefined, internalToken)) {
        send(401, { error: { code: "UNAUTHORIZED", message: "Invalid internal token." } });
        return true;
      }
      let raw = "";
      let tooLarge = false;
      try {
        for await (const chunk of req) {
          raw += (chunk as Buffer).toString("utf8");
          if (raw.length > 2_000_000) tooLarge = true;
        }
      } catch {
        send(400, { error: { code: "VALIDATION_ERROR", message: "Unreadable body." } });
        return true;
      }
      if (tooLarge) {
        send(413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Restore payload too large." } });
        return true;
      }
      let content: unknown;
      try {
        content = (JSON.parse(raw) as { content?: unknown }).content;
      } catch {
        content = undefined;
      }
      if (typeof content !== "string") {
        send(400, { error: { code: "VALIDATION_ERROR", message: "Body must be { content: string }." } });
        return true;
      }
      try {
        await handleRestore(decodeURIComponent(restoreMatch[1] as string), content);
        send(200, { applied: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const status = /Invalid document name/.test(message) ? 400 : 500;
        log("document.restore_failed", { error: message });
        send(status, { error: { code: status === 400 ? "VALIDATION_ERROR" : "INTERNAL", message } });
      }
      return true;
    }
    if (req.method === "GET" && (healthOnAnyPath || url.pathname === "/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...makeHealth("collaboration"), pendingStores: persistence.pendingCount() }));
      return true;
    }
    return false;
  }

  const healthServer = createServer((req, res) => {
    void handlePlatformHttp(req, res, true);
  });

  // Phase 6: sweeper — retries parked pending stores until they land.
  const sweepIntervalMs = options.storeSweepMs ?? envSource.COLLAB_STORE_SWEEP_MS;
  let sweeper: NodeJS.Timeout | null = null;

  let listening = false;
  return {
    hocuspocus,
    healthServer,
    persistence,
    port,
    // In single-port mode the platform HTTP surface lives on the WS port;
    // report that port so callers wire COLLAB_INTERNAL_URL correctly.
    healthPort: singlePort ? port : healthPort,
    singlePort,
    async listen() {
      await hocuspocus.listen();
      if (!singlePort) {
        await new Promise<void>((resolve) => healthServer.listen(healthPort, resolve));
      }
      listening = true;
      sweeper = setInterval(() => {
        if (persistence.pendingCount() > 0) {
          void persistence.retryPending().then((landed) => {
            if (landed > 0) log("store.sweeper_landed", { landed, pending: persistence.pendingCount() });
          });
        }
      }, sweepIntervalMs);
      sweeper.unref?.();
      log("listening", { port, healthPort: singlePort ? port : healthPort, singlePort });
    },
    async destroy() {
      if (sweeper) {
        clearInterval(sweeper);
        sweeper = null;
      }
      if (listening) {
        // Graceful shutdown flush (Phase 6): force-store every loaded
        // document NOW — bypassing the debounce — so a clean restart never
        // loses edits that were acknowledged into the live documents, then
        // give parked pending stores one final retry cycle.
        for (const [documentName, document] of [...hocuspocus.documents.entries()]) {
          try {
            await persistence.storeNow({
              documentName,
              state: Y.encodeStateAsUpdate(document),
              document,
            });
          } catch (e) {
            log("shutdown.flush_failed", { documentName, error: e instanceof Error ? e.message : String(e) });
          }
        }
        if (persistence.pendingCount() > 0) await persistence.retryPending();
        await hocuspocus.destroy();
        if (!singlePort) {
          await new Promise<void>((resolve) => healthServer.close(() => resolve()));
        }
        listening = false;
      }
      log("destroyed", { port });
    },
  };
}

// ---- process entry point (not started on import, and never under tests) ----
const entry = process.argv[1] ?? "";
const isMain = entry.endsWith("server.ts") || entry.endsWith("server.js");
if (isMain && process.env.NODE_ENV !== "test") {
  const handle = createCollaborationServer();
  void handle.listen().then(() => {
    console.log(`@collabcode/collaboration ws :${handle.port}, health :${handle.healthPort}`);
  });
  const shutdown = (signal: string): void => {
    log("shutdown", { signal });
    void (async () => {
      try {
        await handle.destroy();
        await disconnectPrisma();
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
