import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";
import WebSocket from "ws";

/**
 * Phase 4 tests: invitations v2 (token invite flow), chat history REST,
 * the chat WebSocket gateway, and workspace presence.
 *
 * Uses the same DB-mode strategy as test/integration.test.ts (see
 * test/global-setup.ts): REAL PostgreSQL when available, labelled in-memory
 * fallback otherwise. The WS tests run against a real HTTP server with the
 * real gateway attached.
 */

type Mode = "postgres" | "memory";
let mode: Mode = "memory";
let app: Express;
let repos: import("../src/repositories/types.js").Repos;
let server: Server;
let wsBase = "";
let truncate: (() => Promise<void>) | null = null;
let memoryReset: (() => void) | null = null;
const openSockets = new Set<WebSocket>();

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));

beforeAll(async () => {
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
  const { attachChatGateway } = await import("../src/modules/chat/gateway.js");
  server = createServer(app);
  attachChatGateway(server, repos);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  wsBase = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/chat/ws`;
  console.log(`[phase4] running against DB mode: ${mode}`);
});

afterAll(async () => {
  for (const ws of openSockets) ws.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  if (truncate) await truncate();
  if (memoryReset) memoryReset();
});

afterEach(() => {
  for (const ws of openSockets) ws.close();
  openSockets.clear();
});

// ---------- helpers ----------

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

async function createProject(agent: Agent, name = "Apollo") {
  const r = await mutate(agent, "post", "/api/projects", { name, description: "test project" });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; name: string; role: string };
}

function tokenFromInviteUrl(inviteUrl: string): string {
  const token = inviteUrl.split("/invite/")[1];
  expect(token, inviteUrl).toBeTruthy();
  return token as string;
}

async function invite(owner: Agent, projectId: string, email: string, role: "EDITOR" | "VIEWER" = "EDITOR") {
  const r = await mutate(owner, "post", `/api/projects/${projectId}/invitations`, { email, role });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; inviteUrl: string; status: string; role: string; invitedUserExists: boolean };
}

async function inviteAndAccept(owner: Agent, invitee: Agent, email: string, projectId: string, role: "EDITOR" | "VIEWER" = "EDITOR") {
  const inv = await invite(owner, projectId, email, role);
  const acc = await mutate(invitee, "post", `/api/invitations/${tokenFromInviteUrl(inv.inviteUrl)}/accept`);
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  return inv;
}

/** Registers without an agent and returns a raw Cookie header for WS clients. */
async function registerWithCookies(c = creds("ws")) {
  const csrfRes = await request(app).get("/api/auth/csrf");
  const csrfCookies = (csrfRes.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  const csrfCookie = csrfCookies.find((x) => x.startsWith("cc_csrf="))?.split(";")[0];
  const csrfToken = csrfRes.body.data.csrfToken as string;
  const res = await request(app)
    .post("/api/auth/register")
    .set("Cookie", csrfCookie ?? "")
    .set("x-csrf-token", csrfToken)
    .send(c);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const setCookies = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  const cookie = setCookies.map((x) => x.split(";")[0]).join("; ");
  return { user: res.body.data as { id: string; email: string; name: string }, cookie, creds: c };
}

// ---------- WS helpers ----------

interface Frame {
  type: string;
  [k: string]: unknown;
}

class FrameCollector {
  frames: Frame[] = [];
  private waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  constructor(ws: WebSocket) {
    ws.on("message", (data) => {
      let frame: Frame;
      try {
        frame = JSON.parse(data.toString()) as Frame;
      } catch {
        return;
      }
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(frame)) {
          w.resolve(frame);
          return false;
        }
        return true;
      });
    });
  }
  waitFor(pred: (f: Frame) => boolean, timeoutMs = 6000): Promise<Frame> {
    const existing = this.frames.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }
}

async function connectChat(cookie: string): Promise<{ ws: WebSocket; frames: FrameCollector }> {
  const ws = new WebSocket(wsBase, { headers: { Cookie: cookie } });
  openSockets.add(ws);
  const frames = new FrameCollector(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, frames };
}

async function subscribe(ws: WebSocket, frames: FrameCollector, projectId: string): Promise<Frame> {
  ws.send(JSON.stringify({ type: "subscribe", projectId }));
  return frames.waitFor((f) => f.type === "subscribed" && f.projectId === projectId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function backdateInvitation(invitationId: string): Promise<void> {
  if (mode === "postgres") {
    const { getPrisma } = await import("../src/lib/prisma.js");
    await getPrisma().invitation.update({ where: { id: invitationId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  } else {
    const rec = await repos.invitations.findById(invitationId);
    if (rec) rec.expiresAt = new Date(Date.now() - 60_000);
  }
}

// ---------- invitations ----------

describe("invitations v2 (Phase 4)", () => {
  it("creates a PENDING invitation with a dev link; only the token hash is stored", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const guest = creds("guest");
    const r = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: guest.email, role: "EDITOR" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe("PENDING");
    expect(r.body.data.role).toBe("EDITOR");
    expect(r.body.data.invitedUserExists).toBe(false);
    expect(r.body.data.inviteUrl).toContain("/invite/");
    const raw = tokenFromInviteUrl(r.body.data.inviteUrl as string);
    expect(raw.length).toBeGreaterThanOrEqual(32);
    // The raw token must never be persisted: the stored value is its SHA-256.
    const stored = await repos.invitations.findById(r.body.data.id as string);
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).not.toBe(raw);
    const { hashToken } = await import("../src/utils/tokens.js");
    expect(stored?.tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(r.body.data)).not.toContain(stored?.tokenHash);
    // …and the invitee is NOT a member yet.
    const members = await owner.get(`/api/projects/${project.id}/members`);
    expect(members.body.data).toHaveLength(1);
  });

  it("authorization: EDITOR member gets 403, non-member gets 404, own email 400", async () => {
    const owner = request.agent(app);
    const ownerUser = await mustRegister(owner);
    const project = await createProject(owner);
    const editor = request.agent(app);
    const editorUser = await mustRegister(editor, creds("editor"));
    await inviteAndAccept(owner, editor, editorUser.email, project.id, "EDITOR");

    const byEditor = await mutate(editor, "post", `/api/projects/${project.id}/invitations`, { email: "x@example.com", role: "VIEWER" });
    expect(byEditor.status).toBe(403);
    const listByEditor = await editor.get(`/api/projects/${project.id}/invitations`);
    expect(listByEditor.status).toBe(403);

    const stranger = request.agent(app);
    await mustRegister(stranger, creds("stranger"));
    const byStranger = await mutate(stranger, "post", `/api/projects/${project.id}/invitations`, { email: "x@example.com", role: "VIEWER" });
    expect(byStranger.status).toBe(404);

    const own = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: ownerUser.email, role: "VIEWER" });
    expect(own.status).toBe(400);
  });

  it("duplicate pending invitation → 409 DUPLICATE_INVITATION; already-member → 409 CONFLICT", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const guest = creds("dup");
    await invite(owner, project.id, guest.email, "VIEWER");
    const dup = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: guest.email, role: "EDITOR" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_INVITATION");

    const memberAgent = request.agent(app);
    const memberUser = await mustRegister(memberAgent, creds("member"));
    await inviteAndAccept(owner, memberAgent, memberUser.email, project.id, "VIEWER");
    const again = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: memberUser.email, role: "VIEWER" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CONFLICT");
  });

  it("accept creates the membership with the invited role; a second accept conflicts", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const guest = request.agent(app);
    const guestUser = await mustRegister(guest, creds("guest"));
    const inv = await invite(owner, project.id, guestUser.email, "EDITOR");
    const token = tokenFromInviteUrl(inv.inviteUrl);
    const acc = await mutate(guest, "post", `/api/invitations/${token}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.data.project.id).toBe(project.id);
    expect(acc.body.data.project.role).toBe("EDITOR");
    const members = await owner.get(`/api/projects/${project.id}/members`);
    const row = (members.body.data as { userId: string; role: string }[]).find((m) => m.userId === guestUser.id);
    expect(row?.role).toBe("EDITOR");
    const list = await owner.get(`/api/projects/${project.id}/invitations`);
    expect((list.body.data as { status: string }[])[0]?.status).toBe("ACCEPTED");
    const second = await mutate(guest, "post", `/api/invitations/${token}/accept`);
    expect(second.status).toBe(409);
  });

  it("accept with a different signed-in email → 403 INVITATION_EMAIL_MISMATCH", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const target = creds("target");
    const inv = await invite(owner, project.id, target.email, "VIEWER");
    const wrong = request.agent(app);
    await mustRegister(wrong, creds("wrong"));
    const r = await mutate(wrong, "post", `/api/invitations/${tokenFromInviteUrl(inv.inviteUrl)}/accept`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("INVITATION_EMAIL_MISMATCH");
    const members = await owner.get(`/api/projects/${project.id}/members`);
    expect(members.body.data).toHaveLength(1);
  });

  it("decline records DECLINED and grants no membership", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const guest = request.agent(app);
    const guestUser = await mustRegister(guest, creds("guest"));
    const inv = await invite(owner, project.id, guestUser.email, "VIEWER");
    const dec = await mutate(guest, "post", `/api/invitations/${tokenFromInviteUrl(inv.inviteUrl)}/decline`);
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
    expect(dec.body.data.status).toBe("DECLINED");
    expect((await guest.get(`/api/projects/${project.id}`)).status).toBe(404);
    const list = await owner.get(`/api/projects/${project.id}/invitations?status=DECLINED`);
    expect(list.body.data).toHaveLength(1);
  });

  it("revoke: owner revokes a pending invite (accept then fails); revoking a settled invite conflicts", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const guest = request.agent(app);
    const guestUser = await mustRegister(guest, creds("guest"));
    const inv = await invite(owner, project.id, guestUser.email, "EDITOR");
    const rev = await mutate(owner, "delete", `/api/projects/${project.id}/invitations/${inv.id}`);
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(rev.body.data.status).toBe("REVOKED");
    const acc = await mutate(guest, "post", `/api/invitations/${tokenFromInviteUrl(inv.inviteUrl)}/accept`);
    expect(acc.status).toBe(409);
    const again = await mutate(owner, "delete", `/api/projects/${project.id}/invitations/${inv.id}`);
    expect(again.status).toBe(409);
    const missing = await mutate(owner, "delete", `/api/projects/${project.id}/invitations/00000000-0000-0000-0000-000000000000`);
    expect(missing.status).toBe(404);
  });

  it("expired invitations read as EXPIRED in the preview and accept returns 410", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const guest = request.agent(app);
    const guestUser = await mustRegister(guest, creds("guest"));
    const inv = await invite(owner, project.id, guestUser.email, "VIEWER");
    await backdateInvitation(inv.id);
    const token = tokenFromInviteUrl(inv.inviteUrl);
    const preview = await request(app).get(`/api/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.status).toBe("EXPIRED");
    const acc = await mutate(guest, "post", `/api/invitations/${token}/accept`);
    expect(acc.status).toBe(410);
    expect(acc.body.error.code).toBe("INVITATION_EXPIRED");
    // A fresh invitation for the same email is allowed after expiry.
    const fresh = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: guestUser.email, role: "VIEWER" });
    expect(fresh.status).toBe(201);
  });

  it("dashboard by-id flow: accept by id joins; another user gets 403; unknown id 404", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const guest = request.agent(app);
    const guestUser = await mustRegister(guest, creds("guest"));
    const inv = await invite(owner, project.id, guestUser.email, "EDITOR");
    // Someone else cannot answer this invitation by id (email binding).
    const other = request.agent(app);
    await mustRegister(other, creds("other"));
    const wrong = await mutate(other, "post", `/api/invitations/by-id/${inv.id}/accept`);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("INVITATION_EMAIL_MISMATCH");
    const missing = await mutate(guest, "post", `/api/invitations/by-id/00000000-0000-0000-0000-000000000000/accept`);
    expect(missing.status).toBe(404);
    const acc = await mutate(guest, "post", `/api/invitations/by-id/${inv.id}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.data.project.role).toBe("EDITOR");
    expect((await guest.get(`/api/projects/${project.id}`)).status).toBe(200);
    // Decline by id works too.
    const guest2 = request.agent(app);
    const guest2User = await mustRegister(guest2, creds("guest2"));
    const inv2 = await invite(owner, project.id, guest2User.email, "VIEWER");
    const dec = await mutate(guest2, "post", `/api/invitations/by-id/${inv2.id}/decline`);
    expect(dec.status).toBe(200);
    expect(dec.body.data.status).toBe("DECLINED");
    expect((await guest2.get(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it("preview is public and minimal; unknown token 404; /mine lists only the caller's invites", async () => {
    const owner = request.agent(app);
    const ownerUser = await mustRegister(owner);
    const project = await createProject(owner, "Preview Proj");
    const guest = request.agent(app);
    const guestUser = await mustRegister(guest, creds("guest"));
    const other = request.agent(app);
    await mustRegister(other, creds("other"));
    const inv = await invite(owner, project.id, guestUser.email, "EDITOR");
    await invite(owner, project.id, "someoneelse@example.com", "VIEWER");

    const preview = await request(app).get(`/api/invitations/${tokenFromInviteUrl(inv.inviteUrl)}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.projectName).toBe("Preview Proj");
    expect(preview.body.data.inviterName).toBe(ownerUser.name);
    expect(preview.body.data.role).toBe("EDITOR");
    expect(preview.body.data.status).toBe("PENDING");
    const raw = JSON.stringify(preview.body.data);
    expect(raw).not.toContain(guestUser.email);
    expect(raw).not.toContain("members");

    const unknown = await request(app).get(`/api/invitations/${"f".repeat(64)}`);
    expect(unknown.status).toBe(404);

    const mine = await guest.get("/api/invitations/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].projectName).toBe("Preview Proj");
    const othersMine = await other.get("/api/invitations/mine");
    expect(othersMine.body.data).toHaveLength(0);
    const anon = await request(app).get("/api/invitations/mine");
    expect(anon.status).toBe(401);
  });
});

// ---------- chat REST ----------

describe("chat history REST (Phase 4)", () => {
  it("paginates newest-first with a cursor (55 messages, limit 50)", async () => {
    const owner = request.agent(app);
    const ownerUser = await mustRegister(owner);
    const project = await createProject(owner);
    for (let i = 1; i <= 55; i++) {
      await repos.messages.create({ projectId: project.id, senderId: ownerUser.id, content: `msg-${i}` });
    }
    const page1 = await owner.get(`/api/projects/${project.id}/messages?limit=50`);
    expect(page1.status, JSON.stringify(page1.body)).toBe(200);
    expect(page1.body.data.messages).toHaveLength(50);
    expect(page1.body.data.nextCursor).toBeTruthy();
    expect(page1.body.data.messages[0].sender.name).toBe(ownerUser.name);
    const page2 = await owner.get(`/api/projects/${project.id}/messages?limit=50&cursor=${page1.body.data.nextCursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.data.messages).toHaveLength(5);
    expect(page2.body.data.nextCursor).toBeNull();
    const ids = new Set([
      ...(page1.body.data.messages as { id: string }[]).map((m) => m.id),
      ...(page2.body.data.messages as { id: string }[]).map((m) => m.id),
    ]);
    expect(ids.size).toBe(55);
    const bad = await owner.get(`/api/projects/${project.id}/messages?cursor=00000000-0000-0000-0000-000000000000`);
    expect(bad.status).toBe(400);
  });

  it("non-members get 404 for history and presence", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const stranger = request.agent(app);
    await mustRegister(stranger, creds("stranger"));
    expect((await stranger.get(`/api/projects/${project.id}/messages`)).status).toBe(404);
    expect((await stranger.get(`/api/projects/${project.id}/presence`)).status).toBe(404);
  });
});

// ---------- chat WebSocket gateway ----------

describe("chat WebSocket gateway (Phase 4)", () => {
  it("delivers messages in real time to room members and persists them", async () => {
    const ownerReg = await registerWithCookies(creds("owner"));
    const guestReg = await registerWithCookies(creds("guest"));
    const owner = request.agent(app);
    // Log the same users in via agents for REST calls (fresh sessions are fine).
    const csrfO = await syncCsrf(owner);
    const loginO = await owner.post("/api/auth/login").set("x-csrf-token", csrfO).send({ email: ownerReg.creds.email, password: ownerReg.creds.password });
    expect(loginO.status, JSON.stringify(loginO.body)).toBe(200);
    const project = await createProject(owner);
    const guest = request.agent(app);
    const csrfG = await syncCsrf(guest);
    const loginG = await guest.post("/api/auth/login").set("x-csrf-token", csrfG).send({ email: guestReg.creds.email, password: guestReg.creds.password });
    expect(loginG.status).toBe(200);
    await inviteAndAccept(owner, guest, guestReg.user.email, project.id, "EDITOR");

    const a = await connectChat(ownerReg.cookie);
    const b = await connectChat(guestReg.cookie);
    await subscribe(a.ws, a.frames, project.id);
    await subscribe(b.ws, b.frames, project.id);

    b.ws.send(JSON.stringify({ type: "message", projectId: project.id, content: "hello from guest", clientMessageId: "cm-1" }));
    const got = await a.frames.waitFor((f) => f.type === "message");
    const msg = got.message as { content: string; sender: { name: string }; projectId: string };
    expect(msg.content).toBe("hello from guest");
    expect(msg.sender.name).toBe(guestReg.user.name);
    expect(msg.projectId).toBe(project.id);
    expect(got.clientMessageId).toBe("cm-1");
    // Sender also receives the broadcast (echo reconciles the optimistic copy).
    await b.frames.waitFor((f) => f.type === "message");

    const history = await owner.get(`/api/projects/${project.id}/messages`);
    expect(history.status).toBe(200);
    const contents = (history.body.data.messages as { content: string }[]).map((m) => m.content);
    expect(contents).toContain("hello from guest");
  });

  it("workspace isolation: a subscriber of another project receives nothing", async () => {
    const ownerReg = await registerWithCookies(creds("owner"));
    const otherReg = await registerWithCookies(creds("other"));
    const owner = request.agent(app);
    const csrfO = await syncCsrf(owner);
    await owner.post("/api/auth/login").set("x-csrf-token", csrfO).send({ email: ownerReg.creds.email, password: ownerReg.creds.password });
    const other = request.agent(app);
    const csrfT = await syncCsrf(other);
    await other.post("/api/auth/login").set("x-csrf-token", csrfT).send({ email: otherReg.creds.email, password: otherReg.creds.password });
    const projectA = await createProject(owner, "Project A");
    const projectB = await createProject(other, "Project B");

    const a = await connectChat(ownerReg.cookie);
    const b = await connectChat(otherReg.cookie);
    await subscribe(a.ws, a.frames, projectA.id);
    await subscribe(b.ws, b.frames, projectB.id);
    a.ws.send(JSON.stringify({ type: "message", projectId: projectA.id, content: "secret-of-a" }));
    await a.frames.waitFor((f) => f.type === "message");
    await sleep(400);
    const leaked = b.frames.frames.filter(
      (f) => f.type === "message" && (f.message as { content?: string } | undefined)?.content === "secret-of-a",
    );
    expect(leaked).toHaveLength(0);
  });

  it("non-member subscribe gets a FORBIDDEN error frame and the socket closes", async () => {
    const ownerReg = await registerWithCookies(creds("owner"));
    const outsiderReg = await registerWithCookies(creds("outsider"));
    const owner = request.agent(app);
    const csrfO = await syncCsrf(owner);
    await owner.post("/api/auth/login").set("x-csrf-token", csrfO).send({ email: ownerReg.creds.email, password: ownerReg.creds.password });
    const project = await createProject(owner);

    const out = await connectChat(outsiderReg.cookie);
    const closed = new Promise<number>((resolve) => out.ws.once("close", (code) => resolve(code)));
    out.ws.send(JSON.stringify({ type: "subscribe", projectId: project.id }));
    const err = await out.frames.waitFor((f) => f.type === "error");
    expect(err.code).toBe("FORBIDDEN");
    expect(await closed).toBe(4403);
  });

  it("rejects unauthenticated upgrades (no cookie → 401)", async () => {
    const ws = new WebSocket(wsBase);
    openSockets.add(ws);
    const outcome = await new Promise<{ status?: number; opened: boolean }>((resolve) => {
      ws.once("open", () => resolve({ opened: true }));
      ws.once("unexpected-response", (_req, res) => resolve({ opened: false, status: res.statusCode }));
      ws.once("error", () => resolve({ opened: false }));
    });
    expect(outcome.opened).toBe(false);
    expect(outcome.status ?? 401).toBe(401);
  });

  it("frame validation: empty message, unknown type, ping → pong", async () => {
    const ownerReg = await registerWithCookies(creds("owner"));
    const owner = request.agent(app);
    const csrfO = await syncCsrf(owner);
    await owner.post("/api/auth/login").set("x-csrf-token", csrfO).send({ email: ownerReg.creds.email, password: ownerReg.creds.password });
    const project = await createProject(owner);
    const a = await connectChat(ownerReg.cookie);
    await subscribe(a.ws, a.frames, project.id);
    a.ws.send(JSON.stringify({ type: "message", projectId: project.id, content: "   " }));
    const err = await a.frames.waitFor((f) => f.type === "error" && f.code === "VALIDATION_ERROR");
    expect(err).toBeTruthy();
    a.ws.send(JSON.stringify({ type: "bogus" }));
    const unknown = await a.frames.waitFor((f) => f.type === "error" && f.code === "UNKNOWN_TYPE");
    expect(unknown).toBeTruthy();
    a.ws.send(JSON.stringify({ type: "ping" }));
    await a.frames.waitFor((f) => f.type === "pong");
    const history = await owner.get(`/api/projects/${project.id}/messages`);
    expect(history.body.data.messages).toHaveLength(0);
  });

  it("presence: subscribe + active-file frame show online; disconnect sets lastSeenAt", async () => {
    const ownerReg = await registerWithCookies(creds("owner"));
    const guestReg = await registerWithCookies(creds("guest"));
    const owner = request.agent(app);
    const csrfO = await syncCsrf(owner);
    await owner.post("/api/auth/login").set("x-csrf-token", csrfO).send({ email: ownerReg.creds.email, password: ownerReg.creds.password });
    const guest = request.agent(app);
    const csrfG = await syncCsrf(guest);
    await guest.post("/api/auth/login").set("x-csrf-token", csrfG).send({ email: guestReg.creds.email, password: guestReg.creds.password });
    const project = await createProject(owner);
    await inviteAndAccept(owner, guest, guestReg.user.email, project.id, "VIEWER");
    const files = await owner.get(`/api/projects/${project.id}/files`);
    const fileId = (files.body.data as { id: string; type: string }[]).find((f) => f.type === "FILE")?.id as string;

    const a = await connectChat(ownerReg.cookie);
    await subscribe(a.ws, a.frames, project.id);
    a.ws.send(JSON.stringify({ type: "presence", projectId: project.id, activeFileId: fileId }));
    const presFrame = await a.frames.waitFor(
      (f) => f.type === "presence" && (f.users as { activeFileId?: string | null }[]).some((u) => u.activeFileId === fileId),
    );
    expect(presFrame).toBeTruthy();

    const restPresence = await owner.get(`/api/projects/${project.id}/presence`);
    expect(restPresence.status).toBe(200);
    const online = restPresence.body.data.online as { userId: string; activeFileId: string | null }[];
    expect(online.map((o) => o.userId)).toContain(ownerReg.user.id);
    expect(online.find((o) => o.userId === ownerReg.user.id)?.activeFileId).toBe(fileId);
    const members = restPresence.body.data.members as { userId: string; online: boolean; lastSeenAt: string | null }[];
    const guestRow = members.find((m) => m.userId === guestReg.user.id);
    expect(guestRow?.online).toBe(false);
    expect(guestRow?.lastSeenAt).toBeNull();

    // Guest comes online, then leaves: REST presence flips and lastSeenAt is set.
    const b = await connectChat(guestReg.cookie);
    await subscribe(b.ws, b.frames, project.id);
    await a.frames.waitFor(
      (f) => f.type === "presence" && (f.users as { userId: string }[]).some((u) => u.userId === guestReg.user.id),
    );
    b.ws.close();
    await sleep(300);
    const after = await owner.get(`/api/projects/${project.id}/presence`);
    const guestAfter = (after.body.data.members as { userId: string; online: boolean; lastSeenAt: string | null }[]).find(
      (m) => m.userId === guestReg.user.id,
    );
    expect(guestAfter?.online).toBe(false);
    expect(guestAfter?.lastSeenAt).toBeTruthy();
  });

  it("VIEWER members can send chat messages (documented allowance)", async () => {
    const ownerReg = await registerWithCookies(creds("owner"));
    const viewerReg = await registerWithCookies(creds("viewer"));
    const owner = request.agent(app);
    const csrfO = await syncCsrf(owner);
    await owner.post("/api/auth/login").set("x-csrf-token", csrfO).send({ email: ownerReg.creds.email, password: ownerReg.creds.password });
    const viewer = request.agent(app);
    const csrfV = await syncCsrf(viewer);
    await viewer.post("/api/auth/login").set("x-csrf-token", csrfV).send({ email: viewerReg.creds.email, password: viewerReg.creds.password });
    const project = await createProject(owner);
    await inviteAndAccept(owner, viewer, viewerReg.user.email, project.id, "VIEWER");
    const v = await connectChat(viewerReg.cookie);
    await subscribe(v.ws, v.frames, project.id);
    v.ws.send(JSON.stringify({ type: "message", projectId: project.id, content: "viewer says hi" }));
    const got = await v.frames.waitFor((f) => f.type === "message");
    expect((got.message as { content: string }).content).toBe("viewer says hi");
  });
});
