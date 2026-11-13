import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";

/**
 * Phase 6 API tests: version sources/labels/authors and the restore flow.
 *
 * The collaboration server's internal restore endpoint is replaced by a
 * recording HTTP stub (the real endpoint is covered end-to-end by the
 * collaboration suite and the live smoke): the API must snapshot the
 * caller's current content, call the stub with the version's content, and
 * surface 502 COLLAB_UNAVAILABLE — applying nothing — when it fails.
 *
 * DB strategy matches the other suites: real PostgreSQL via
 * test/global-setup.ts, labelled in-memory fallback otherwise.
 */

type Mode = "postgres" | "memory";
let mode: Mode = "memory";
let app: Express;
let repos: import("../src/repositories/types.js").Repos;
let truncate: (() => Promise<void>) | null = null;
let memoryReset: (() => void) | null = null;

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));

// ---------- collab restore stub ----------
interface StubCall {
  documentName: string;
  content: string;
  token: string | undefined;
}
const stubCalls: StubCall[] = [];
let stubFails = false;
let stubServer: Server;

beforeAll(async () => {
  stubServer = createServer((req, res) => {
    const match = /^\/internal\/documents\/(.+)\/restore$/.exec(req.url ?? "");
    if (req.method !== "POST" || !match) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const body = JSON.parse(raw) as { content: string };
      stubCalls.push({
        documentName: decodeURIComponent(match[1] as string),
        content: body.content,
        token: req.headers["x-internal-token"] as string | undefined,
      });
      if (stubFails) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "stub collab failure" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ applied: true }));
    });
  });
  await new Promise<void>((resolve) => stubServer.listen(0, "127.0.0.1", resolve));
  const stubPort = (stubServer.address() as AddressInfo).port;
  process.env.COLLAB_INTERNAL_URL = `http://127.0.0.1:${stubPort}`;

  let marker: { mode?: string; databaseUrl?: string } = {};
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as typeof marker;
  } catch {
    marker = {};
  }
  const { createApp } = await import("../src/app.js");
  if (marker.mode === "postgres" && marker.databaseUrl) {
    mode = "postgres";
    process.env.DATABASE_URL = marker.databaseUrl;
    const { prismaRepos } = await import("../src/repositories/prisma.js");
    repos = prismaRepos;
    app = createApp();
    const { getPrisma } = await import("../src/lib/prisma.js");
    truncate = async () => {
      await getPrisma().$executeRawUnsafe(
        'TRUNCATE TABLE "RefreshToken", "Invitation", "DocumentVersion", "ChatMessage", "Execution", "YjsDocument", "File", "ProjectMember", "Project", "User" RESTART IDENTITY CASCADE',
      );
    };
    await truncate();
  } else {
    mode = "memory";
    const { createMemoryRepos } = await import("./memoryRepos.js");
    const mem = createMemoryRepos();
    repos = mem;
    memoryReset = () => mem.reset();
    app = createApp(mem);
  }
  console.log(`[phase6] running against DB mode: ${mode}`);
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => stubServer.close(() => resolve()));
});

beforeEach(async () => {
  stubCalls.length = 0;
  stubFails = false;
  if (truncate) await truncate();
  if (memoryReset) memoryReset();
});

// ---------- helpers (same shapes as phase4) ----------
type Agent = ReturnType<typeof request.agent>;

async function syncCsrf(agent: Agent): Promise<string> {
  const r = await agent.get("/api/auth/csrf");
  expect(r.status).toBe(200);
  return r.body.data.csrfToken as string;
}

let seq = 0;
function creds(label: string) {
  seq += 1;
  return { name: `${label} User`, email: `${label}${seq}@example.com`.toLowerCase(), password: "password123" };
}

async function mutate(agent: Agent, method: "post" | "patch" | "delete", url: string, body?: unknown) {
  const csrf = await syncCsrf(agent);
  let q = agent[method](url).set("x-csrf-token", csrf);
  if (body !== undefined) q = q.send(body as object);
  return q;
}

async function mustRegister(agent: Agent, c = creds("user")) {
  const csrf = await syncCsrf(agent);
  const r = await agent.post("/api/auth/register").set("x-csrf-token", csrf).send(c);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; email: string; name: string };
}

async function createProject(agent: Agent, name = "Versions Project") {
  const r = await mutate(agent, "post", "/api/projects", { name, description: "phase6" });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; name: string; role: string };
}

interface FileDto {
  id: string;
  name: string;
  path: string;
  type: string;
  content?: string | null;
}

async function listFiles(agent: Agent, projectId: string): Promise<FileDto[]> {
  const r = await agent.get(`/api/projects/${projectId}/files`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as FileDto[];
}

interface VersionMeta {
  id: string;
  fileId: string;
  createdBy: string;
  createdAt: string;
  source: string;
  label: string | null;
  author: { id: string; name: string };
  sizeBytes: number;
  content?: string;
}

async function listVersions(agent: Agent, fileId: string): Promise<VersionMeta[]> {
  const r = await agent.get(`/api/files/${fileId}/versions`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as VersionMeta[];
}

async function saveVersion(agent: Agent, fileId: string, content: string, label?: string) {
  const r = await mutate(agent, "post", `/api/files/${fileId}/versions`, label ? { content, label } : { content });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as FileDto;
}

/** Owner + project + the seeded src/main.ts file, ready for version work. */
async function setupProject(ownerLabel = "owner") {
  const owner = request.agent(app);
  const me = await mustRegister(owner, creds(ownerLabel));
  const project = await createProject(owner);
  const files = await listFiles(owner, project.id);
  const main = files.find((f) => f.name === "main.ts") ?? files.find((f) => f.type === "FILE");
  expect(main, "seeded file").toBeTruthy();
  return { owner, me, project, file: main as FileDto };
}

// ---------- tests ----------

describe("Phase 6 — version metadata (source, label, author, size)", () => {
  it("create with a label stores a SNAPSHOT; without one a SAVE; list hides content, get returns it", async () => {
    const { owner, me, file } = await setupProject();

    await saveVersion(owner, file.id, "plain save content");
    await saveVersion(owner, file.id, "snapshot content", "Release candidate");

    const list = await listVersions(owner, file.id);
    const snapshot = list.find((v) => v.label === "Release candidate");
    const plain = list.find((v) => v.source === "SAVE" && v.sizeBytes === "plain save content".length);
    expect(snapshot).toBeTruthy();
    expect(snapshot?.source).toBe("SNAPSHOT");
    expect(snapshot?.sizeBytes).toBe("snapshot content".length);
    expect(snapshot?.author).toEqual({ id: me.id, name: me.name });
    expect(plain).toBeTruthy();
    for (const v of list) expect(v).not.toHaveProperty("content");

    const got = await owner.get(`/api/files/${file.id}/versions/${snapshot?.id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.content).toBe("snapshot content");
    expect(got.body.data.source).toBe("SNAPSHOT");
    expect(got.body.data.author.name).toBe(me.name);
  });
});

describe("Phase 6 — restore through the collaboration server", () => {
  it("snapshots the caller's live content, then applies the version via the collab endpoint", async () => {
    const { owner, project, file } = await setupProject();
    const idsBefore = new Set((await listVersions(owner, file.id)).map((v) => v.id));
    await saveVersion(owner, file.id, "version one content");
    const v1 = (await listVersions(owner, file.id)).find((v) => !idsBefore.has(v.id));
    expect(v1).toBeTruthy();
    await saveVersion(owner, file.id, "version two content");

    const r = await mutate(owner, "post", `/api/files/${file.id}/versions/${v1?.id}/restore`, {
      currentContent: "live content right now",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.restoredVersionId).toBe(v1?.id);
    expect(typeof r.body.data.snapshotVersionId).toBe("string");

    // The collab stub received exactly the version's content, addressed to
    // this file's document, with the shared internal token.
    expect(stubCalls).toHaveLength(1);
    expect(stubCalls[0]?.documentName).toBe(`project:${project.id}:file:${file.id}`);
    expect(stubCalls[0]?.content).toBe("version one content");
    expect(stubCalls[0]?.token).toBe(["dev", "collab", "internal", "token"].join("-"));

    // The pre-restore snapshot holds the caller's live content.
    const after = await listVersions(owner, file.id);
    const snap = after.find((v) => v.id === r.body.data.snapshotVersionId);
    expect(snap?.source).toBe("SNAPSHOT");
    expect(snap?.label).toBe("Before restore");
    const snapFull = await owner.get(`/api/files/${file.id}/versions/${snap?.id}`);
    expect(snapFull.body.data.content).toBe("live content right now");
  });

  it("returns 502 COLLAB_UNAVAILABLE and applies nothing when the collab server fails", async () => {
    const { owner, file } = await setupProject();
    await saveVersion(owner, file.id, "some version");
    const list = await listVersions(owner, file.id);
    const target = list[0];
    expect(target).toBeTruthy();

    stubFails = true;
    const r = await mutate(owner, "post", `/api/files/${file.id}/versions/${target?.id}/restore`, {
      currentContent: "live content",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(502);
    expect(r.body.error.code).toBe("COLLAB_UNAVAILABLE");
    expect(stubCalls).toHaveLength(1); // it tried — and the failure is surfaced, not hidden

    // Documented semantics: the pre-restore snapshot remains (harmless,
    // honest), but no restore was applied or recorded.
    const after = await listVersions(owner, file.id);
    expect(after.some((v) => v.label === "Before restore")).toBe(true);
    expect(after.every((v) => v.source !== "RESTORE")).toBe(true);
  });

  it("VIEWER cannot restore (403), non-members cannot see the file (404)", async () => {
    const { owner, project, file } = await setupProject();
    await saveVersion(owner, file.id, "v-one");
    const [target] = await listVersions(owner, file.id);
    expect(target).toBeTruthy();

    // Invite a VIEWER and accept.
    const viewer = request.agent(app);
    const viewerCreds = creds("viewer");
    const viewerUser = await mustRegister(viewer, viewerCreds);
    expect(viewerUser.email).toBe(viewerCreds.email);
    const inv = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: viewerCreds.email, role: "VIEWER" });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const token = (inv.body.data.inviteUrl as string).split("/invite/")[1];
    const acc = await mutate(viewer, "post", `/api/invitations/${token}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);

    const asViewer = await mutate(viewer, "post", `/api/files/${file.id}/versions/${target?.id}/restore`, { currentContent: "x" });
    expect(asViewer.status, JSON.stringify(asViewer.body)).toBe(403);
    expect(stubCalls).toHaveLength(0);

    // A registered stranger is not a member at all → 404.
    const stranger = request.agent(app);
    await mustRegister(stranger, creds("stranger"));
    const asStranger = await mutate(stranger, "post", `/api/files/${file.id}/versions/${target?.id}/restore`, { currentContent: "x" });
    expect(asStranger.status, JSON.stringify(asStranger.body)).toBe(404);
    expect(stubCalls).toHaveLength(0);
  });

  it("restoring an unknown version id is a 404 and writes nothing", async () => {
    const { owner, file } = await setupProject();
    const before = await listVersions(owner, file.id);
    const r = await mutate(owner, "post", `/api/files/${file.id}/versions/99999999-9999-4999-8999-999999999999/restore`, {
      currentContent: "live",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(stubCalls).toHaveLength(0);
    const after = await listVersions(owner, file.id);
    expect(after).toHaveLength(before.length); // no pre-restore snapshot for a restore that never started
  });

  it("a version belonging to another file cannot be restored through this file (404)", async () => {
    const { owner, project, file } = await setupProject();
    const created = await mutate(owner, "post", `/api/projects/${project.id}/files`, {
      name: "other.ts",
      type: "FILE",
      content: "other file content",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const otherFile = created.body.data as FileDto;
    const otherVersions = await listVersions(owner, otherFile.id);
    expect(otherVersions.length).toBeGreaterThan(0);

    const r = await mutate(owner, "post", `/api/files/${file.id}/versions/${otherVersions[0]?.id}/restore`, {
      currentContent: "live",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(stubCalls).toHaveLength(0);
  });
});
