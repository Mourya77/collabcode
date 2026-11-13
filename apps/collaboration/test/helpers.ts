import net from "node:net";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { buildDocumentName } from "../src/documentName.js";

export const TEST_SECRET = "collab-test-secret-collab-test-secret-0123456789";
export const TEST_DB_URL = "postgresql://postgres:postgres@127.0.0.1:55434/collabcode_collab_test?schema=public";

/** Signs a collab token exactly the way the API does (HS256, audience "collab"). */
export function signTestToken(
  claims: { userId: string; projectId: string; role: "OWNER" | "EDITOR" | "VIEWER"; name: string },
  options: { expiresInSeconds?: number; secret?: string } = {},
): string {
  return jwt.sign(
    { projectId: claims.projectId, role: claims.role, name: claims.name },
    options.secret ?? TEST_SECRET,
    {
      algorithm: "HS256",
      subject: claims.userId,
      audience: "collab",
      expiresIn: options.expiresInSeconds ?? 600,
    },
  );
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Polls `fn` until it returns a truthy value; throws with `label` on timeout. */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  { timeoutMs = 15_000, intervalMs = 50, label = "condition" }: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const start = Date.now();
  let lastError: unknown;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitFor timed out after ${timeoutMs}ms waiting for: ${label}${lastError ? ` (last error: ${String(lastError)})` : ""}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface TestClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  ytext: Y.Text;
  /** Resolves when the provider reports the document synced. */
  synced: Promise<void>;
  /** Resolves with the failure reason if authentication is rejected. */
  authFailed: Promise<string>;
  destroy(): void;
}

export function connectClient(args: {
  port: number;
  projectId: string;
  fileId: string;
  token: string;
  user?: { id: string; name: string; color: string };
}): TestClient {
  const doc = new Y.Doc();
  let resolveSynced!: () => void;
  let resolveAuthFailed!: (reason: string) => void;
  const synced = new Promise<void>((r) => (resolveSynced = r));
  const authFailed = new Promise<string>((r) => (resolveAuthFailed = r));
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${args.port}`,
    name: buildDocumentName(args.projectId, args.fileId),
    document: doc,
    token: args.token,
    // ws is the Node WebSocket implementation for the test environment.
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    onSynced: () => resolveSynced(),
    onAuthenticationFailed: ({ reason }) => resolveAuthFailed(reason ?? "authentication failed"),
  });
  if (args.user && provider.awareness) {
    provider.awareness.setLocalStateField("user", args.user);
  }
  return {
    doc,
    provider,
    ytext: doc.getText("content"),
    synced,
    authFailed,
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
}

/** Decodes persisted YjsDocument bytes into plain text (server-state assertions). */
export function textFromPersistedState(state: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const text = doc.getText("content").toString();
  doc.destroy();
  return text;
}
