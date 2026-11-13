import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getPrisma } from "../src/prisma.js";
import { createCollaborationServer, type CollabServerHandle } from "../src/server.js";
import { DEV_COLLAB_INTERNAL_TOKEN } from "../src/config/env.js";
import { buildDocumentName } from "../src/documentName.js";
import { freePort, signTestToken, textFromPersistedState, waitFor } from "./helpers.js";

/**
 * Phase 6 integration tests: persistence hardening (retry + pending-store
 * sweeper + shutdown flush + persisted acknowledgements) and the internal
 * restore endpoint — against the REAL server and REAL PostgreSQL.
 *
 * The DB-interruption test stops and restarts the dedicated collab test
 * Postgres (55434). The suite runs single-fork/serial, and the restart is
 * in a finally block, so the shared instance is always left running.
 */

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api");
const pgEnv = { ...process.env, COLLABCODE_PG_DIR: "/tmp/collabcode-pg-collab", COLLABCODE_PG_PORT: "55434" };
const SEED = "line one\nline two\n";

const prisma = getPrisma();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pgCtl(action: "start" | "stop"): void {
  execSync(`node scripts/dev-db.mjs ${action}`, { cwd: apiDir, stdio: "pipe", env: pgEnv });
}

interface Scenario {
  ownerId: string;
  editorId: string;
  projectId: string;
  fileId: string;
  tokenFor(userId: string, role: "OWNER" | "EDITOR" | "VIEWER", name: string): string;
}

let scenarioSeq = 100;
async function seedScenario(): Promise<Scenario> {
  scenarioSeq += 1;
  const mk = (name: string) =>
    prisma.user.create({
      data: {
        name,
        email: `${name.toLowerCase().replace(/\s+/g, ".")}.p6-${scenarioSeq}@example.com`,
        passwordHash: "not-a-real-hash",
      },
    });
  const owner = await mk("Olivia Owner");
  const editor = await mk("Ed Editor");
  const project = await prisma.project.create({ data: { name: "Phase6 Project", ownerId: owner.id } });
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: owner.id, role: "OWNER" },
      { projectId: project.id, userId: editor.id, role: "EDITOR" },
    ],
  });
  const file = await prisma.file.create({
    data: { projectId: project.id, parentId: null, name: "main.ts", type: "FILE", path: "main.ts" },
  });
  await prisma.documentVersion.create({ data: { fileId: file.id, createdBy: owner.id, content: SEED } });
  return {
    ownerId: owner.id,
    editorId: editor.id,
    projectId: project.id,
    fileId: file.id,
    tokenFor: (userId, role, name) => signTestToken({ userId, projectId: project.id, role, name }),
  };
}

interface AckClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  ytext: Y.Text;
  synced: Promise<void>;
  /** Stateless payloads received from the server, parsed. */
  stateless: { type?: string; at?: string }[];
  destroy(): void;
}

function connectAckClient(args: { port: number; projectId: string; fileId: string; token: string }): AckClient {
  const doc = new Y.Doc();
  let resolveSynced!: () => void;
  const synced = new Promise<void>((r) => (resolveSynced = r));
  const stateless: AckClient["stateless"] = [];
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${args.port}`,
    name: buildDocumentName(args.projectId, args.fileId),
    document: doc,
    token: args.token,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    onSynced: () => resolveSynced(),
    onStateless: ({ payload }) => {
      try {
        stateless.push(JSON.parse(payload) as { type?: string; at?: string });
      } catch {
        /* not ours */
      }
    },
  });
  return {
    doc,
    provider,
    ytext: doc.getText("content"),
    synced,
    stateless,
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
}

async function startServer(extra: Parameters<typeof createCollaborationServer>[0] = {}): Promise<CollabServerHandle> {
  const handle = createCollaborationServer({
    port: await freePort(),
    healthPort: await freePort(),
    storeDebounceMs: 100,
    maxDebounceMs: 500,
    versionSyncMinIntervalMs: 0,
    quiet: true,
    ...extra,
  });
  await handle.listen();
  return handle;
}

let clients: AckClient[] = [];
function client(args: Parameters<typeof connectAckClient>[0]): AckClient {
  const c = connectAckClient(args);
  clients.push(c);
  return c;
}

beforeAll(() => {
  let mode = "unavailable";
  try {
    mode = (JSON.parse(fs.readFileSync(markerPath, "utf8")) as { mode?: string }).mode ?? "unavailable";
  } catch {
    /* marker missing */
  }
  if (mode !== "postgres") {
    throw new Error("Phase 6 collab tests require the real embedded PostgreSQL (global setup failed).");
  }
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "YjsDocument", "DocumentVersion", "ChatMessage", "Execution", "RefreshToken", "File", "ProjectMember", "Project", "User" RESTART IDENTITY CASCADE',
  );
});

afterEach(async () => {
  for (const c of clients) c.destroy();
  clients = [];
  await sleep(300);
});

describe("Phase 6 — persistence acknowledgements + restore endpoint", () => {
  it("broadcasts a persisted acknowledgement after a store lands", async () => {
    const s = await seedScenario();
    const server = await startServer();
    try {
      const a = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editorId, "EDITOR", "Ed Editor") });
      await a.synced;
      await waitFor(() => a.ytext.toString() === SEED, { label: "seeded" });
      a.ytext.insert(a.ytext.length, "ack-edit;");
      await waitFor(() => a.stateless.some((m) => m.type === "persisted" && typeof m.at === "string"), {
        label: "persisted stateless ack",
        timeoutMs: 20_000,
      });
      const row = await prisma.yjsDocument.findUnique({ where: { fileId: s.fileId } });
      expect(row && textFromPersistedState(new Uint8Array(row.state))).toContain("ack-edit;");
    } finally {
      await server.destroy();
    }
  });

  it("restore via the internal endpoint replaces the live document for all connected clients", async () => {
    const s = await seedScenario();
    const server = await startServer();
    try {
      const a = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.ownerId, "OWNER", "Olivia Owner") });
      const b = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editorId, "EDITOR", "Ed Editor") });
      await Promise.all([a.synced, b.synced]);
      await waitFor(() => a.ytext.toString() === SEED && b.ytext.toString() === SEED, { label: "both seeded" });
      a.ytext.insert(a.ytext.length, "later-edit;");
      await waitFor(() => b.ytext.toString().includes("later-edit;"), { label: "edit propagated" });

      const docName = buildDocumentName(s.projectId, s.fileId);
      const url = `http://127.0.0.1:${server.healthPort}/internal/documents/${encodeURIComponent(docName)}/restore`;

      const unauthenticated = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "nope" }),
      });
      expect(unauthenticated.status).toBe(401);
      expect(a.ytext.toString()).toContain("later-edit;"); // untouched

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-token": DEV_COLLAB_INTERNAL_TOKEN },
        body: JSON.stringify({ content: "restored content\n" }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ applied: true });

      await waitFor(() => a.ytext.toString() === "restored content\n" && b.ytext.toString() === "restored content\n", {
        label: "both clients converged to restored content",
        timeoutMs: 20_000,
      });

      // The restored state flows through normal persistence + version sync-back.
      await waitFor(
        async () => {
          const latest = await prisma.documentVersion.findFirst({ where: { fileId: s.fileId }, orderBy: { createdAt: "desc" } });
          return latest?.content === "restored content\n" && latest?.source === "AUTOSAVE";
        },
        { label: "restored content versioned as AUTOSAVE", timeoutMs: 20_000 },
      );
    } finally {
      await server.destroy();
    }
  });

  it("graceful shutdown flushes loaded documents even inside the debounce window", async () => {
    const s = await seedScenario();
    // Debounce far longer than the test: only the shutdown flush can persist this edit.
    const server = await startServer({ storeDebounceMs: 60_000, maxDebounceMs: 60_000 });
    const a = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editorId, "EDITOR", "Ed Editor") });
    await a.synced;
    await waitFor(() => a.ytext.toString() === SEED, { label: "seeded" });
    a.ytext.insert(a.ytext.length, "flush-edit;");
    const expected = a.ytext.toString();
    await sleep(300); // the update reaches the server, but no store has fired (60s debounce)
    await server.destroy();
    a.destroy();
    clients = clients.filter((c) => c !== a);

    const row = await prisma.yjsDocument.findUnique({ where: { fileId: s.fileId } });
    expect(row && textFromPersistedState(new Uint8Array(row.state))).toBe(expected);

    // And a fresh server + client recover exactly that content.
    const second = await startServer();
    try {
      const recovered = client({ port: second.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.ownerId, "OWNER", "Olivia Owner") });
      await recovered.synced;
      await waitFor(() => recovered.ytext.toString() === expected, { label: "content recovered after restart", timeoutMs: 20_000 });
    } finally {
      await second.destroy();
    }
  });
});

describe("Phase 6 — database interruption recovery", () => {
  // This test simulates an outage by stopping the suite's OWN embedded
  // Postgres (dev-db.mjs on 55434). Against an external database
  // (CC_COLLAB_TEST_DATABASE_URL, e.g. a CI service container) the suite
  // does not own the server and cannot stop it — skip there rather than
  // fake an outage. It runs in the default embedded mode.
  it.skipIf(Boolean(process.env.CC_COLLAB_TEST_DATABASE_URL))(
    "edits during a DB outage are parked, signalled persist-failed, and land via the sweeper when the DB returns",
    async () => {
      const s = await seedScenario();
      const server = await startServer({ storeMaxAttempts: 2, storeSweepMs: 500 });
      try {
        const a = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editorId, "EDITOR", "Ed Editor") });
        await a.synced;
        await waitFor(() => a.ytext.toString() === SEED, { label: "seeded" });
        a.ytext.insert(a.ytext.length, "before-outage;");
        await waitFor(() => a.stateless.some((m) => m.type === "persisted"), { label: "pre-outage persisted ack", timeoutMs: 20_000 });

        pgCtl("stop");
        try {
          a.ytext.insert(a.ytext.length, "during-outage;");
          const expected = a.ytext.toString();

          await waitFor(() => a.stateless.some((m) => m.type === "persist-failed"), {
            label: "persist-failed stateless after retries exhausted",
            timeoutMs: 45_000,
          });
          const health = (await (await fetch(`http://127.0.0.1:${server.healthPort}/`)).json()) as { pendingStores?: number };
          expect(health.pendingStores ?? 0).toBeGreaterThanOrEqual(1);
          expect(server.persistence.pendingCount()).toBeGreaterThanOrEqual(1);

          pgCtl("start");
          // Sweeper retries the parked store; the client is told it landed.
          const ackIndex = a.stateless.length;
          await waitFor(() => a.stateless.slice(ackIndex).some((m) => m.type === "persisted"), {
            label: "persisted ack after DB recovery",
            timeoutMs: 45_000,
          });
          await waitFor(
            async () => {
              const row = await prisma.yjsDocument.findUnique({ where: { fileId: s.fileId } });
              return row ? textFromPersistedState(new Uint8Array(row.state)) === expected : false;
            },
            { label: "full content durable after recovery", timeoutMs: 30_000 },
          );

          // A fresh connection receives the complete text.
          const fresh = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.ownerId, "OWNER", "Olivia Owner") });
          await fresh.synced;
          await waitFor(() => fresh.ytext.toString() === expected, { label: "fresh client receives full text", timeoutMs: 20_000 });
        } finally {
          // Never leave the shared test database down for other suites.
          try {
            pgCtl("start");
          } catch {
            /* already running */
          }
        }
      } finally {
        await server.destroy();
      }
    },
    180_000,
  );
});
