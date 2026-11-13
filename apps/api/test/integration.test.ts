import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";

/**
 * End-to-end API integration tests (supertest).
 *
 * DB mode comes from .test-db.json, written by test/global-setup.ts:
 *  - "postgres": a REAL PostgreSQL with the committed migrations applied
 *    (`prisma migrate deploy`); tables are truncated between tests.
 *  - "memory": the in-memory repository fallback — labelled here and in the
 *    setup output; it exercises service logic only, not SQL/migrations.
 */

type Mode = "postgres" | "memory";
let mode: Mode = "memory";
let app: Express;
let truncate: (() => Promise<void>) | null = null;
let memoryReset: (() => void) | null = null;

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));

beforeAll(async () => {
  let marker: { mode?: string; databaseUrl?: string } = {};
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as typeof marker;
  } catch {
    marker = {};
  }
  if (marker.mode === "postgres" && marker.databaseUrl) {
    mode = "postgres";
    process.env.DATABASE_URL = marker.databaseUrl;
    const { createApp } = await import("../src/app.js");
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
    const { createApp } = await import("../src/app.js");
    const { createMemoryRepos } = await import("./memoryRepos.js");
    const repos = createMemoryRepos();
    memoryReset = () => repos.reset();
    app = createApp(repos);
  }
  console.log(`[integration] running against DB mode: ${mode}`);
});

beforeEach(async () => {
  if (truncate) await truncate();
  if (memoryReset) memoryReset();
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

async function register(agent: Agent, c = creds("user")) {
  const csrf = await syncCsrf(agent);
  const r = await agent.post("/api/auth/register").set("x-csrf-token", csrf).send(c);
  return { r, creds: c, user: r.body?.data };
}

async function mustRegister(agent: Agent, c = creds("user")) {
  const { r, user } = await register(agent, c);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return user as { id: string; email: string; name: string };
}

async function mutate(agent: Agent, method: "post" | "patch" | "delete", url: string, body?: unknown) {
  const csrf = await syncCsrf(agent);
  let q = agent[method](url).set("x-csrf-token", csrf);
  if (body !== undefined) q = q.send(body as object);
  return q;
}

function cookieValue(setCookie: string[] | undefined, name: string): string | null {
  for (const c of setCookie ?? []) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(c);
    if (m?.[1] !== undefined) return decodeURIComponent(m[1]);
  }
  return null;
}

async function createProject(agent: Agent, name = "Apollo") {
  const r = await mutate(agent, "post", "/api/projects", { name, description: "test project" });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; name: string; role: string };
}

/** Extracts the raw invitation token from a create-invitation response's inviteUrl. */
function tokenFromInviteUrl(inviteUrl: string): string {
  const token = inviteUrl.split("/invite/")[1];
  expect(token, inviteUrl).toBeTruthy();
  return token as string;
}

/**
 * Phase 4 invite flow: the owner creates an invitation and the invitee
 * accepts it (membership exists only after acceptance).
 */
async function inviteAndAccept(
  owner: Agent,
  invitee: Agent,
  inviteeUser: { email: string },
  projectId: string,
  role: "EDITOR" | "VIEWER",
) {
  const inv = await mutate(owner, "post", `/api/projects/${projectId}/invitations`, { email: inviteeUser.email, role });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  expect(inv.body.data.status).toBe("PENDING");
  const token = tokenFromInviteUrl(inv.body.data.inviteUrl as string);
  const acc = await mutate(invitee, "post", `/api/invitations/${token}/accept`);
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  return acc.body.data.project as { id: string; role: string };
}

async function listFiles(agent: Agent, projectId: string) {
  const r = await agent.get(`/api/projects/${projectId}/files`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as { id: string; name: string; type: string; path: string; parentId: string | null }[];
}

// ---------- auth ----------

describe(`auth flows (DB mode: integration)`, () => {
  it("registers, sets cookies, and never leaks the password hash", async () => {
    const agent = request.agent(app);
    const { r } = await register(agent);
    expect(r.status).toBe(201);
    expect(r.body.success).toBe(true);
    expect(r.body.data.email).toContain("@example.com");
    expect(JSON.stringify(r.body)).not.toContain("passwordHash");
    expect(JSON.stringify(r.body)).not.toContain("password123");
    const cookies = (r.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookies).toContain("cc_access=");
    expect(cookies).toContain("cc_refresh=");
    expect(cookies).toContain("cc_csrf=");
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(r.body.data.email);
  });

  it("rejects duplicate emails with 409 CONFLICT", async () => {
    const a1 = request.agent(app);
    const c = creds("dup");
    await mustRegister(a1, c);
    const a2 = request.agent(app);
    const { r } = await register(a2, c);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CONFLICT");
  });

  it("rejects short passwords and bad emails with 400 VALIDATION_ERROR", async () => {
    const agent = request.agent(app);
    const csrf = await syncCsrf(agent);
    const short = await agent.post("/api/auth/register").set("x-csrf-token", csrf)
      .send({ name: "X", email: "x@example.com", password: "short" });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe("VALIDATION_ERROR");
    const badEmail = await agent.post("/api/auth/register").set("x-csrf-token", csrf)
      .send({ name: "X", email: "not-an-email", password: "password123" });
    expect(badEmail.status).toBe(400);
  });

  it("login: wrong password and unknown email both give the same generic 401", async () => {
    const agent = request.agent(app);
    const c = creds("login");
    await mustRegister(agent, c);
    const a2 = request.agent(app);
    const csrf = await syncCsrf(a2);
    const wrong = await a2.post("/api/auth/login").set("x-csrf-token", csrf).send({ email: c.email, password: "wrongpassword" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe("Invalid email or password.");
    const ghost = await a2.post("/api/auth/login").set("x-csrf-token", csrf).send({ email: "ghost@example.com", password: "password123" });
    expect(ghost.status).toBe(401);
    expect(ghost.body.error.message).toBe("Invalid email or password.");
    const ok = await a2.post("/api/auth/login").set("x-csrf-token", csrf).send({ email: c.email, password: c.password });
    expect(ok.status).toBe(200);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const anon = request.agent(app);
    expect((await anon.get("/api/auth/me")).status).toBe(401);
    expect((await anon.get("/api/users/me")).status).toBe(401);
    expect((await anon.get("/api/projects")).status).toBe(401);
  });

  it("refresh rotation: new token works, reuse of the old token revokes everything", async () => {
    const agent = request.agent(app);
    const { r } = await register(agent);
    const oldRefresh = cookieValue(r.headers["set-cookie"] as unknown as string[], "cc_refresh");
    expect(oldRefresh).toBeTruthy();

    const rotated = await mutate(agent, "post", "/api/auth/refresh");
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    const newRefresh = cookieValue(rotated.headers["set-cookie"] as unknown as string[], "cc_refresh");
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(oldRefresh);

    // Reuse the OLD (now revoked) token -> 401 and the whole family is revoked.
    const csrf = await syncCsrf(agent);
    const reuse = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `cc_refresh=${oldRefresh}; cc_csrf=${csrf}`)
      .set("x-csrf-token", csrf);
    expect(reuse.status).toBe(401);

    const after = await mutate(agent, "post", "/api/auth/refresh");
    expect(after.status).toBe(401);
  });

  it("logout revokes the session: refresh and me fail afterwards", async () => {
    const agent = request.agent(app);
    await mustRegister(agent);
    const out = await mutate(agent, "post", "/api/auth/logout");
    expect(out.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    const refresh = await mutate(agent, "post", "/api/auth/refresh");
    expect(refresh.status).toBe(401);
  });

  it("blocks mutations without a CSRF token (403)", async () => {
    const agent = request.agent(app);
    await mustRegister(agent);
    const r = await agent.post("/api/projects").send({ name: "NoCsrf" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it("PATCH /api/users/me updates the profile", async () => {
    const agent = request.agent(app);
    await mustRegister(agent);
    const r = await mutate(agent, "patch", "/api/users/me", { name: "Renamed User", avatarUrl: "https://example.com/a.png" });
    expect(r.status).toBe(200);
    expect(r.body.data.name).toBe("Renamed User");
    expect(r.body.data.avatarUrl).toBe("https://example.com/a.png");
    const bad = await mutate(agent, "patch", "/api/users/me", { avatarUrl: "not-a-url" });
    expect(bad.status).toBe(400);
  });
});

// ---------- projects & authorization ----------

describe("projects, membership and permissions", () => {
  it("creates a project with OWNER membership and seed files", async () => {
    const agent = request.agent(app);
    await mustRegister(agent);
    const project = await createProject(agent);
    expect(project.role).toBe("OWNER");
    const files = await listFiles(agent, project.id);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["src", "src/main.ts", "welcome.md"]);
    const main = files.find((f) => f.path === "src/main.ts");
    const got = await agent.get(`/api/files/${main!.id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.content).toContain("greet");
  });

  it("lists with search and pagination, only the caller's projects", async () => {
    const agent = request.agent(app);
    await mustRegister(agent);
    await createProject(agent, "Alpha");
    await createProject(agent, "Beta");
    await createProject(agent, "Gamma");
    const all = await agent.get("/api/projects");
    expect(all.body.data.total).toBe(3);
    const page1 = await agent.get("/api/projects?limit=2&page=1");
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.total).toBe(3);
    const page2 = await agent.get("/api/projects?limit=2&page=2");
    expect(page2.body.data.items).toHaveLength(1);
    const search = await agent.get("/api/projects?search=alph");
    expect(search.body.data.total).toBe(1);
    expect(search.body.data.items[0].name).toBe("Alpha");

    const other = request.agent(app);
    await mustRegister(other, creds("other"));
    const othersList = await other.get("/api/projects");
    expect(othersList.body.data.total).toBe(0);
  });

  it("non-members get 404 for a private project, its files and file ids", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const files = await listFiles(owner, project.id);
    const stranger = request.agent(app);
    await mustRegister(stranger, creds("stranger"));
    expect((await stranger.get(`/api/projects/${project.id}`)).status).toBe(404);
    expect((await stranger.get(`/api/projects/${project.id}/files`)).status).toBe(404);
    expect((await stranger.get(`/api/files/${files[0]!.id}`)).status).toBe(404);
    const del = await mutate(stranger, "delete", `/api/files/${files[0]!.id}`);
    expect(del.status).toBe(404);
  });

  it("OWNER can patch and delete; EDITOR cannot patch the project", async () => {
    const owner = request.agent(app);
    const ownerUser = await mustRegister(owner);
    const project = await createProject(owner);
    const editor = request.agent(app);
    const editorUser = await mustRegister(editor, creds("editor"));
    const invite = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: editorUser.email, role: "EDITOR" });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    expect(invite.body.data.role).toBe("EDITOR");
    expect(invite.body.data.status).toBe("PENDING");
    // Phase 4: the invitation alone grants nothing — the editor accepts first.
    const accepted = await mutate(editor, "post", `/api/invitations/${tokenFromInviteUrl(invite.body.data.inviteUrl)}/accept`);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    const editorPatch = await mutate(editor, "patch", `/api/projects/${project.id}`, { name: "Hijacked" });
    expect(editorPatch.status).toBe(403);
    const ownerPatch = await mutate(owner, "patch", `/api/projects/${project.id}`, { name: "Renamed", description: "new desc" });
    expect(ownerPatch.status).toBe(200);
    expect(ownerPatch.body.data.name).toBe("Renamed");

    const editorDelete = await mutate(editor, "delete", `/api/projects/${project.id}`);
    expect(editorDelete.status).toBe(403);
    const ownerDelete = await mutate(owner, "delete", `/api/projects/${project.id}`);
    expect(ownerDelete.status).toBe(200);
    expect((await owner.get(`/api/projects/${project.id}`)).status).toBe(404);
    void ownerUser;
  });

  it("invitations v2: a pending invite grants no access until the invitee accepts", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    // Unregistered emails can be invited now (Phase 4) — the invite waits for them.
    const ghost = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: "ghost@example.com", role: "VIEWER" });
    expect(ghost.status, JSON.stringify(ghost.body)).toBe(201);
    expect(ghost.body.data.invitedUserExists).toBe(false);

    const member = request.agent(app);
    const memberUser = await mustRegister(member, creds("member"));
    const first = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: memberUser.email, role: "VIEWER" });
    expect(first.status).toBe(201);
    expect(first.body.data.invitedUserExists).toBe(true);
    // Not a member yet: project access is still 404 and the member list is unchanged.
    expect((await member.get(`/api/projects/${project.id}`)).status).toBe(404);
    const before = await owner.get(`/api/projects/${project.id}/members`);
    expect(before.body.data).toHaveLength(1);
    const dup = await mutate(owner, "post", `/api/projects/${project.id}/invitations`, { email: memberUser.email, role: "VIEWER" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_INVITATION");
    // Accept → membership appears.
    const acc = await mutate(member, "post", `/api/invitations/${tokenFromInviteUrl(first.body.data.inviteUrl)}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect((await member.get(`/api/projects/${project.id}`)).status).toBe(200);
    const after = await owner.get(`/api/projects/${project.id}/members`);
    expect(after.body.data).toHaveLength(2);
  });

  it("VIEWER is read-only: cannot create files, save versions or patch", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const files = await listFiles(owner, project.id);
    const main = files.find((f) => f.path === "src/main.ts")!;
    const viewer = request.agent(app);
    const viewerUser = await mustRegister(viewer, creds("viewer"));
    await inviteAndAccept(owner, viewer, viewerUser, project.id, "VIEWER");

    expect((await viewer.get(`/api/projects/${project.id}`)).status).toBe(200);
    expect((await viewer.get(`/api/files/${main.id}`)).status).toBe(200);
    const create = await mutate(viewer, "post", `/api/projects/${project.id}/files`, { name: "nope.ts", type: "FILE" });
    expect(create.status).toBe(403);
    const save = await mutate(viewer, "post", `/api/files/${main.id}/versions`, { content: "hacked" });
    expect(save.status).toBe(403);
    const patch = await mutate(viewer, "patch", `/api/files/${main.id}`, { content: "hacked" });
    expect(patch.status).toBe(403);
  });

  it("members cannot escalate their own role; owner cannot change own role", async () => {
    const owner = request.agent(app);
    const ownerUser = await mustRegister(owner);
    const project = await createProject(owner);
    const editor = request.agent(app);
    const editorUser = await mustRegister(editor, creds("ed2"));
    await inviteAndAccept(owner, editor, editorUser, project.id, "EDITOR");

    const selfEscalate = await mutate(editor, "patch", `/api/projects/${project.id}/members/${editorUser.id}`, { role: "OWNER" });
    expect(selfEscalate.status).toBe(403);
    const ownerSelf = await mutate(owner, "patch", `/api/projects/${project.id}/members/${ownerUser.id}`, { role: "VIEWER" });
    expect(ownerSelf.status).toBe(403);

    const demote = await mutate(owner, "patch", `/api/projects/${project.id}/members/${editorUser.id}`, { role: "VIEWER" });
    expect(demote.status).toBe(200);
    expect(demote.body.data.role).toBe("VIEWER");
  });

  it("owner can remove a member; a member can leave; access ends immediately", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const m1 = request.agent(app);
    const m1User = await mustRegister(m1, creds("m1"));
    const m2 = request.agent(app);
    const m2User = await mustRegister(m2, creds("m2"));
    await inviteAndAccept(owner, m1, m1User, project.id, "EDITOR");
    await inviteAndAccept(owner, m2, m2User, project.id, "VIEWER");

    const removed = await mutate(owner, "delete", `/api/projects/${project.id}/members/${m1User.id}`);
    expect(removed.status).toBe(200);
    expect((await m1.get(`/api/projects/${project.id}`)).status).toBe(404);

    const leave = await mutate(m2, "delete", `/api/projects/${project.id}/members/${m2User.id}`);
    expect(leave.status).toBe(200);
    expect((await m2.get(`/api/projects/${project.id}`)).status).toBe(404);
  });
});

// ---------- files & versions ----------

describe("files and versions", () => {
  it("EDITOR can create nested files; rename/move updates paths; versions accumulate", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const editor = request.agent(app);
    const editorUser = await mustRegister(editor, creds("ed3"));
    await inviteAndAccept(owner, editor, editorUser, project.id, "EDITOR");

    const folder = await mutate(editor, "post", `/api/projects/${project.id}/files`, { name: "docs", type: "FOLDER" });
    expect(folder.status, JSON.stringify(folder.body)).toBe(201);
    const file = await mutate(editor, "post", `/api/projects/${project.id}/files`, { name: "a.md", type: "FILE", parentId: folder.body.data.id, content: "# v1" });
    expect(file.status).toBe(201);
    expect(file.body.data.path).toBe("docs/a.md");

    const renamed = await mutate(editor, "patch", `/api/files/${folder.body.data.id}`, { name: "guides" });
    expect(renamed.status).toBe(200);
    const after = await listFiles(owner, project.id);
    expect(after.find((f) => f.id === file.body.data.id)?.path).toBe("guides/a.md");

    const saved = await mutate(editor, "patch", `/api/files/${file.body.data.id}`, { content: "# v2" });
    expect(saved.status).toBe(200);
    expect(saved.body.data.content).toBe("# v2");
    const explicit = await mutate(editor, "post", `/api/files/${file.body.data.id}/versions`, { content: "# v3" });
    expect(explicit.status).toBe(201);

    const versions = await editor.get(`/api/files/${file.body.data.id}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body.data).toHaveLength(3);
    expect(versions.body.data[0]).not.toHaveProperty("content");
    const latestId = versions.body.data[0].id as string;
    const one = await editor.get(`/api/files/${file.body.data.id}/versions/${latestId}`);
    expect(one.body.data.content).toBe("# v3");
    const got = await editor.get(`/api/files/${file.body.data.id}`);
    expect(got.body.data.content).toBe("# v3");
  });

  it("rejects path traversal names with 400", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    for (const name of ["../evil.ts", "a/b.ts", "..", "a\\b.ts"]) {
      const r = await mutate(owner, "post", `/api/projects/${project.id}/files`, { name, type: "FILE" });
      expect(r.status, name).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects duplicate paths with 409", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const dup = await mutate(owner, "post", `/api/projects/${project.id}/files`, { name: "welcome.md", type: "FILE" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CONFLICT");
  });

  it("deleting a folder cascades to children and their versions", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const folder = await mutate(owner, "post", `/api/projects/${project.id}/files`, { name: "temp", type: "FOLDER" });
    const child = await mutate(owner, "post", `/api/projects/${project.id}/files`, { name: "x.ts", type: "FILE", parentId: folder.body.data.id, content: "x" });
    expect(child.status).toBe(201);
    const del = await mutate(owner, "delete", `/api/files/${folder.body.data.id}`);
    expect(del.status).toBe(200);
    expect((await owner.get(`/api/files/${child.body.data.id}`)).status).toBe(404);
    const files = await listFiles(owner, project.id);
    expect(files.map((f) => f.path)).not.toContain("temp/x.ts");
    expect(files.map((f) => f.path)).not.toContain("temp");
  });
});

// ---------- collaboration tokens (Phase 3) ----------

describe("collaboration tokens (Phase 3)", () => {
  it("issues a collab JWT carrying the caller's role for a member", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const r = await mutate(owner, "post", "/api/collab/token", { projectId: project.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.role).toBe("OWNER");
    expect(r.body.data.user.email).toContain("@example.com");
    expect(new Date(r.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The token must verify as an audience-"collab" JWT with the right claims.
    const { verifyCollabToken } = await import("../src/utils/tokens.js");
    const claims = verifyCollabToken(r.body.data.token as string);
    expect(claims?.projectId).toBe(project.id);
    expect(claims?.role).toBe("OWNER");
    // …and must NOT verify as a REST access token for another audience: the
    // access-token verifier rejects it only by shape (no aud pinned) — instead
    // assert the collab verifier rejects plain access tokens.
    const { signAccessToken } = await import("../src/utils/tokens.js");
    expect(verifyCollabToken(signAccessToken(claims!.userId))).toBeNull();
  });

  it("returns the invited member's role (VIEWER) to an invitee", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const viewer = request.agent(app);
    const viewerUser = await mustRegister(viewer, creds("viewer"));
    await inviteAndAccept(owner, viewer, viewerUser, project.id, "VIEWER");
    const r = await mutate(viewer, "post", "/api/collab/token", { projectId: project.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.role).toBe("VIEWER");
  });

  it("returns 404 (not 403) for a non-member so project existence is not leaked", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const outsider = request.agent(app);
    await mustRegister(outsider, creds("outsider"));
    const r = await mutate(outsider, "post", "/api/collab/token", { projectId: project.id });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const anon = request.agent(app);
    const csrf = await syncCsrf(anon);
    const r = await anon.post("/api/collab/token").set("x-csrf-token", csrf).send({ projectId: project.id });
    expect(r.status).toBe(401);
  });
});

// ---------- openapi ----------

describe("openapi docs", () => {
  it("serves the OpenAPI JSON covering all endpoint groups", async () => {
    const r = await request(app).get("/api/openapi.json");
    expect(r.status).toBe(200);
    const paths = Object.keys(r.body.paths as object);
    for (const p of ["/api/auth/login", "/api/auth/refresh", "/api/projects", "/api/projects/{projectId}/members/{userId}", "/api/projects/{projectId}/files", "/api/files/{fileId}/versions", "/api/collab/token", "/api/projects/{projectId}/invitations", "/api/projects/{projectId}/invitations/{invitationId}", "/api/invitations/mine", "/api/invitations/{token}", "/api/invitations/{token}/accept", "/api/invitations/{token}/decline", "/api/projects/{projectId}/messages", "/api/projects/{projectId}/presence"]) {
      expect(paths, p).toContain(p);
    }
  });
  it("serves Swagger UI", async () => {
    const r = await request(app).get("/api/docs/");
    expect(r.status).toBe(200);
    expect(r.text.toLowerCase()).toContain("swagger");
  });
});
