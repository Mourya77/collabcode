import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getPrisma } from "../src/prisma.js";
import { createCollaborationServer, type CollabServerHandle } from "../src/server.js";
import {
  connectClient,
  freePort,
  signTestToken,
  textFromPersistedState,
  waitFor,
  type TestClient,
} from "./helpers.js";

/**
 * Tests A–H from the Phase 3 spec, run against the REAL Hocuspocus server
 * and a REAL PostgreSQL (embedded binaries; see test/global-setup.ts).
 * There is deliberately no in-memory fallback for these.
 */

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));
const SEED = "line one\nline two\n";

type Role = "OWNER" | "EDITOR" | "VIEWER";
interface Scenario {
  owner: { id: string; name: string };
  editor: { id: string; name: string };
  viewer: { id: string; name: string };
  outsider: { id: string; name: string };
  projectId: string;
  fileId: string;
  tokenFor(userId: string, role: Role, name: string, projectId?: string): string;
}

const prisma = getPrisma();
let server: CollabServerHandle;
let clients: TestClient[] = [];

function client(args: Parameters<typeof connectClient>[0]): TestClient {
  const c = connectClient(args);
  clients.push(c);
  return c;
}

let scenarioSeq = 0;
async function seedScenario(): Promise<Scenario> {
  scenarioSeq += 1;
  const mk = (name: string) =>
    prisma.user.create({
      data: {
        name,
        email: `${name.toLowerCase().replace(/\s+/g, ".")}.s${scenarioSeq}@example.com`,
        passwordHash: "not-a-real-hash",
      },
    });
  const owner = await mk("Olivia Owner");
  const editor = await mk("Ed Editor");
  const viewer = await mk("Vera Viewer");
  const outsider = await mk("Oscar Outsider");
  const project = await prisma.project.create({ data: { name: "Collab Project", ownerId: owner.id } });
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: owner.id, role: "OWNER" },
      { projectId: project.id, userId: editor.id, role: "EDITOR" },
      { projectId: project.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  const file = await prisma.file.create({
    data: { projectId: project.id, parentId: null, name: "main.ts", type: "FILE", path: "main.ts" },
  });
  await prisma.documentVersion.create({ data: { fileId: file.id, createdBy: owner.id, content: SEED } });
  return {
    owner,
    editor,
    viewer,
    outsider,
    projectId: project.id,
    fileId: file.id,
    tokenFor: (userId, role, name, projectId = project.id) =>
      signTestToken({ userId, projectId, role, name }),
  };
}

async function startServerOn(port: number): Promise<CollabServerHandle> {
  const healthPort = await freePort();
  const handle = createCollaborationServer({
    port,
    healthPort,
    storeDebounceMs: 100,
    maxDebounceMs: 500,
    versionSyncMinIntervalMs: 0,
    quiet: true,
  });
  await handle.listen();
  return handle;
}

beforeAll(async () => {
  let mode = "unavailable";
  try {
    mode = (JSON.parse(fs.readFileSync(markerPath, "utf8")) as { mode?: string }).mode ?? "unavailable";
  } catch {
    /* marker missing */
  }
  if (mode !== "postgres") {
    throw new Error(
      "Collaboration integration tests require the real embedded PostgreSQL (global setup failed) — refusing to run against a substitute.",
    );
  }
  server = await startServerOn(await freePort());
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "YjsDocument", "DocumentVersion", "ChatMessage", "Execution", "RefreshToken", "File", "ProjectMember", "Project", "User" RESTART IDENTITY CASCADE',
  );
});

afterEach(async () => {
  for (const c of clients) c.destroy();
  clients = [];
  // Let the server's last-disconnect store flush (debounce is 100ms in this
  // suite) settle before the next test truncates the tables.
  await sleep(700);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("collaboration engine (real server + real PostgreSQL)", () => {
  it("A: two clients connecting to the same file receive the same (seeded) content", async () => {
    const s = await seedScenario();
    const a = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.owner.id, "OWNER", s.owner.name) });
    const b = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editor.id, "EDITOR", s.editor.name) });
    await Promise.all([a.synced, b.synced]);
    await waitFor(() => a.ytext.toString() === SEED && b.ytext.toString() === SEED, { label: "both clients seeded" });
    expect(a.ytext.toString()).toBe(SEED);
    expect(b.ytext.toString()).toBe(SEED);
  });

  it("B+C: simultaneous inserts from two clients converge to identical content containing both", async () => {
    const s = await seedScenario();
    const a = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.owner.id, "OWNER", s.owner.name) });
    const b = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editor.id, "EDITOR", s.editor.name) });
    await Promise.all([a.synced, b.synced]);
    // Truly concurrent: both go offline, insert at the same position, reconnect.
    a.provider.disconnect();
    b.provider.disconnect();
    await sleep(200);
    a.ytext.insert(0, "AAA-");
    b.ytext.insert(0, "BBB-");
    a.provider.connect();
    b.provider.connect();
    await waitFor(
      () => a.ytext.toString() === b.ytext.toString() && a.ytext.toString().includes("AAA-") && a.ytext.toString().includes("BBB-"),
      { label: "convergence after concurrent inserts", timeoutMs: 20_000 },
    );
    expect(a.ytext.toString()).toContain(SEED.trim().split("\n")[0] as string);
    expect(a.ytext.length).toBe(SEED.length + 8);
  });

  it("D: a client that disconnects, edits offline and reconnects syncs without losing edits", async () => {
    const s = await seedScenario();
    const a = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.owner.id, "OWNER", s.owner.name) });
    const b = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editor.id, "EDITOR", s.editor.name) });
    await Promise.all([a.synced, b.synced]);
    b.provider.disconnect();
    await sleep(200);
    b.ytext.insert(b.ytext.length, "offline-edit;");
    a.ytext.insert(a.ytext.length, "online-edit;");
    await waitFor(() => a.ytext.toString().includes("online-edit;"), { label: "A sees its own edit" });
    b.provider.connect();
    await waitFor(
      () =>
        a.ytext.toString() === b.ytext.toString() &&
        a.ytext.toString().includes("offline-edit;") &&
        a.ytext.toString().includes("online-edit;"),
      { label: "convergence after reconnect", timeoutMs: 20_000 },
    );
  });

  it("E: a VIEWER can read but their edits never reach the server or other clients", async () => {
    const s = await seedScenario();
    const editor = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editor.id, "EDITOR", s.editor.name) });
    const viewer = client({ port: server.port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.viewer.id, "VIEWER", s.viewer.name) });
    await Promise.all([editor.synced, viewer.synced]);
    await waitFor(() => viewer.ytext.toString() === SEED, { label: "viewer received content" });

    viewer.ytext.insert(0, "viewer-was-here;");
    expect(viewer.ytext.toString()).toContain("viewer-was-here;"); // exists only in the viewer's local doc
    await sleep(1500); // long enough for the (rejected) update + a store cycle
    expect(editor.ytext.toString()).not.toContain("viewer-was-here;");
    const row = await prisma.yjsDocument.findUnique({ where: { fileId: s.fileId } });
    if (row) expect(textFromPersistedState(new Uint8Array(row.state))).not.toContain("viewer-was-here;");
    const latest = await prisma.documentVersion.findFirst({ where: { fileId: s.fileId }, orderBy: { createdAt: "desc" } });
    expect(latest?.content ?? "").not.toContain("viewer-was-here;");
  });

  it("F: unauthorized users cannot access another project's document", async () => {
    const s = await seedScenario();
    const other = await seedScenario(); // outsider IS an editor… of a different scenario project

    const attempts: { name: string; token: string; projectId: string }[] = [
      // Well-formed token naming the victim project, but no membership row.
      { name: "non-member with scoped token", token: s.tokenFor(s.outsider.id, "EDITOR", s.outsider.name), projectId: s.projectId },
      // A real member of ANOTHER project presenting that project's token for this document.
      { name: "member of another project", token: other.tokenFor(other.editor.id, "EDITOR", other.editor.name, other.projectId), projectId: s.projectId },
      // Garbage token.
      { name: "garbage token", token: "not-a-jwt", projectId: s.projectId },
    ];

    for (const attempt of attempts) {
      const c = client({ port: server.port, projectId: attempt.projectId, fileId: s.fileId, token: attempt.token });
      const outcome = await Promise.race([
        c.synced.then(() => "synced" as const),
        c.authFailed.then(() => "auth-failed" as const),
        sleep(4000).then(() => "timeout" as const),
      ]);
      expect(outcome, attempt.name).not.toBe("synced");
      expect(c.ytext.toString(), attempt.name).toBe("");
      c.destroy();
    }
  });

  it("H: disconnected users disappear from the presence (awareness) list", async () => {
    const s = await seedScenario();
    const a = client({
      port: server.port, projectId: s.projectId, fileId: s.fileId,
      token: s.tokenFor(s.owner.id, "OWNER", s.owner.name),
      user: { id: s.owner.id, name: s.owner.name, color: "#f43f5e" },
    });
    const b = client({
      port: server.port, projectId: s.projectId, fileId: s.fileId,
      token: s.tokenFor(s.editor.id, "EDITOR", s.editor.name),
      user: { id: s.editor.id, name: s.editor.name, color: "#22c55e" },
    });
    await Promise.all([a.synced, b.synced]);
    const statesOf = (c: TestClient) => c.provider.awareness?.getStates().size ?? 0;
    await waitFor(() => statesOf(a) === 2 && statesOf(b) === 2, { label: "both users present in awareness" });
    const names = [...(a.provider.awareness?.getStates().values() ?? [])].map(
      (st) => (st as { user?: { name?: string } }).user?.name,
    );
    expect(names).toContain(s.owner.name);
    expect(names).toContain(s.editor.name);

    b.destroy();
    clients = clients.filter((c) => c !== b);
    await waitFor(() => statesOf(a) === 1, { label: "departed user removed from awareness", timeoutMs: 20_000 });
  });
});

describe("G: persistence across a collaboration-server restart", () => {
  it("persisted Yjs state (and the synced DocumentVersion) survive a server restart", async () => {
    const s = await seedScenario();
    const port = await freePort();

    const first = await startServerOn(port);
    const editor = client({ port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.editor.id, "EDITOR", s.editor.name) });
    await editor.synced;
    await waitFor(() => editor.ytext.toString() === SEED, { label: "seeded before edit" });
    editor.ytext.insert(editor.ytext.length, "persisted-edit;");
    const expected = editor.ytext.toString();

    // Wait until the debounced store has actually landed in PostgreSQL…
    await waitFor(
      async () => {
        const row = await prisma.yjsDocument.findUnique({ where: { fileId: s.fileId } });
        return row ? textFromPersistedState(new Uint8Array(row.state)) === expected : false;
      },
      { label: "Yjs state persisted to PostgreSQL", timeoutMs: 20_000 },
    );
    // …and the plain-text version sync has mirrored it for the REST world.
    await waitFor(
      async () => {
        const latest = await prisma.documentVersion.findFirst({ where: { fileId: s.fileId }, orderBy: { createdAt: "desc" } });
        return latest?.content === expected;
      },
      { label: "DocumentVersion synced from Yjs state", timeoutMs: 20_000 },
    );
    editor.destroy();
    clients = clients.filter((c) => c !== editor);
    await first.destroy();

    // A brand-new server instance on the SAME port + database must recover it.
    let second: CollabServerHandle | null = null;
    let lastError: unknown;
    for (let i = 0; i < 20 && !second; i++) {
      try {
        second = await startServerOn(port);
      } catch (e) {
        lastError = e;
        await sleep(300);
      }
    }
    if (!second) throw lastError instanceof Error ? lastError : new Error("could not restart server on the same port");
    try {
      const recovered = client({ port, projectId: s.projectId, fileId: s.fileId, token: s.tokenFor(s.owner.id, "OWNER", s.owner.name) });
      await recovered.synced;
      await waitFor(() => recovered.ytext.toString() === expected, { label: "content recovered after restart", timeoutMs: 20_000 });
      expect(recovered.ytext.toString()).toBe(expected);
    } finally {
      await second.destroy();
    }
  });
});
