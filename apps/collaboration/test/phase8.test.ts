import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getPrisma } from "../src/prisma.js";
import { loadEnv } from "../src/config/env.js";
import { createCollaborationServer, type CollabServerHandle } from "../src/server.js";
import { connectClient, freePort, signTestToken, waitFor, type TestClient } from "./helpers.js";
import { buildDocumentName } from "../src/documentName.js";

/**
 * Phase 8 tests: single-port mode.
 *
 * Hosts like Render expose exactly ONE port per service. In single-port
 * mode the collaboration server must serve its platform HTTP surface
 * (GET /health + the token-guarded internal restore endpoint) on the WS
 * port itself, must NOT start a second listener, and WebSocket sync must
 * work unchanged on that same port. Runs against the real server + real
 * PostgreSQL, like the rest of this suite.
 */

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));
const prisma = getPrisma();
const INTERNAL_TOKEN = "<MASKED_SECRET_004>";

let server: CollabServerHandle;
let wsPort = 0;
let wouldBeHealthPort = 0;
let clients: TestClient[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  let mode = "unavailable";
  try {
    mode = (JSON.parse(fs.readFileSync(markerPath, "utf8")) as { mode?: string }).mode ?? "unavailable";
  } catch {
    /* marker missing */
  }
  if (mode !== "postgres") {
    throw new Error("Phase 8 collab tests require the real embedded PostgreSQL (global setup failed).");
  }
  wsPort = await freePort();
  wouldBeHealthPort = await freePort();
  server = createCollaborationServer({
    port: wsPort,
    healthPort: wouldBeHealthPort,
    singlePort: true,
    internalToken: INTERNAL_TOKEN,
    storeDebounceMs: 100,
    maxDebounceMs: 500,
    versionSyncMinIntervalMs: 0,
    quiet: true,
  });
  await server.listen();
});

afterAll(async () => {
  await server.destroy();
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

async function seedFile(): Promise<{ projectId: string; fileId: string; token: string }> {
  const owner = await prisma.user.create({
    data: { name: "Portia Owner", email: `portia.${Date.now()}@example.com`, passwordHash: "not-a-real-hash" },
  });
  const project = await prisma.project.create({ data: { name: "Single Port Project", ownerId: owner.id } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: owner.id, role: "OWNER" } });
  const file = await prisma.file.create({
    data: { projectId: project.id, parentId: null, name: "main.ts", type: "FILE", path: "main.ts" },
  });
  await prisma.documentVersion.create({ data: { fileId: file.id, createdBy: owner.id, content: "seed line\n" } });
  const token = signTestToken({ userId: owner.id, projectId: project.id, role: "OWNER", name: owner.name });
  return { projectId: project.id, fileId: file.id, token };
}

describe("single-port mode (Phase 8)", () => {
  it("reports singlePort and maps healthPort onto the WS port", () => {
    expect(server.singlePort).toBe(true);
    expect(server.healthPort).toBe(wsPort);
  });

  it("serves GET /health on the WS port", async () => {
    const res = await fetch(`http://127.0.0.1:${wsPort}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service?: string; status?: string; pendingStores?: number };
    expect(body.service).toBe("collaboration");
    expect(body.status).toBe("ok");
    expect(body.pendingStores).toBe(0);
  });

  it("does NOT open a second listener on the health port", async () => {
    await expect(fetch(`http://127.0.0.1:${wouldBeHealthPort}/health`)).rejects.toThrow();
  });

  it("syncs a document over WebSocket on the same port", async () => {
    const s = await seedFile();
    const c = connectClient({ port: wsPort, projectId: s.projectId, fileId: s.fileId, token: s.token });
    clients.push(c);
    await c.synced;
    expect(c.ytext.toString()).toBe("seed line\n");
    c.ytext.insert(c.ytext.length, "via single port\n");
    await waitFor(() => c.ytext.toString().includes("via single port"), { label: "local edit visible" });
  });

  it("serves the internal restore endpoint on the WS port (token-guarded)", async () => {
    const s = await seedFile();
    const name = buildDocumentName(s.projectId, s.fileId);
    const url = `http://127.0.0.1:${wsPort}/internal/documents/${encodeURIComponent(name)}/restore`;

    const denied = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "nope\n" }),
    });
    expect(denied.status).toBe(401);

    const c = connectClient({ port: wsPort, projectId: s.projectId, fileId: s.fileId, token: s.token });
    clients.push(c);
    await c.synced;

    const applied = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": INTERNAL_TOKEN },
      body: JSON.stringify({ content: "restored on one port\n" }),
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    await waitFor(() => c.ytext.toString() === "restored on one port\n", { label: "restore converged to client" });
  });
});

describe("single-port env derivation (Phase 8)", () => {
  const prodBase = {
    NODE_ENV: "production",
    COLLAB_INTERNAL_TOKEN: "u".repeat(24),
    JWT_SECRET: "s".repeat(40),
  } as const;

  it("production + explicit PORT (Render-style) enables single-port mode", () => {
    expect(loadEnv({ ...prodBase, PORT: "10000" }).SINGLE_PORT_MODE).toBe(true);
  });

  it("production without PORT keeps dual-port mode", () => {
    expect(loadEnv({ ...prodBase }).SINGLE_PORT_MODE).toBe(false);
  });

  it("explicit SINGLE_PORT wins over derivation in both directions", () => {
    expect(loadEnv({ ...prodBase, PORT: "10000", SINGLE_PORT: "false" }).SINGLE_PORT_MODE).toBe(false);
    expect(loadEnv({ SINGLE_PORT: "true" }).SINGLE_PORT_MODE).toBe(true);
  });

  it("development defaults to dual-port", () => {
    expect(loadEnv({}).SINGLE_PORT_MODE).toBe(false);
  });
});
