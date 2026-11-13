import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";
import WebSocket from "ws";

/**
 * Phase 7 — security & error-handling regression tests.
 *
 * Covers the Phase 7 audit fixes:
 * - session cookie attributes (HttpOnly / SameSite / Path scoping)
 * - body-parser failures map to 400/413 JSON envelopes (never a 500,
 *   never an HTML stack page, never leaked internals)
 * - unknown 500s return the generic envelope without internal messages
 * - GET /api/health/ready reflects the database ping (200 / 503)
 * - file content size cap + rename-conflict + cycle-move guards
 * - chat WebSocket: foreign Origin rejected (CSWSH), allow-listed Origin
 *   and no-Origin clients connect, per-socket frame rate limit closes
 *   flooding sockets (4429), oversized frames close with 1009
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
let server: Server;
let wsBase = "";
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
  // Tight rate budget so the flood test is fast and deterministic.
  attachChatGateway(server, repos, { rateLimit: { maxFrames: 5, windowMs: 60_000, maxViolations: 2 } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  wsBase = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/chat/ws`;
  console.log(`[phase7] running against DB mode: ${mode}`);
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

/** Registers without an agent and returns the raw Set-Cookie values + a Cookie header. */
async function registerRaw(c = creds("raw")) {
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
  return { user: res.body.data as { id: string; email: string; name: string }, setCookies, cookie };
}

// ---------- cookie attributes ----------

describe("session cookie attributes (Phase 7)", () => {
  it("register sets HttpOnly access/refresh cookies, a readable CSRF cookie, SameSite=Lax, and a Path-scoped refresh cookie", async () => {
    const { setCookies } = await registerRaw(creds("cookie"));
    const access = setCookies.find((x) => x.startsWith("cc_access="));
    const refresh = setCookies.find((x) => x.startsWith("cc_refresh="));
    const csrf = setCookies.find((x) => x.startsWith("cc_csrf="));
    expect(access, "access cookie set").toBeTruthy();
    expect(refresh, "refresh cookie set").toBeTruthy();
    expect(csrf, "csrf cookie set").toBeTruthy();
    for (const c of [access, refresh, csrf] as string[]) {
      expect(c).toMatch(/SameSite=Lax/i);
      // Test env is not production and COOKIE_SECURE is unset → Secure off.
      expect(c).not.toMatch(/;\s*Secure/i);
    }
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/Path=\//);
    expect(refresh).toMatch(/HttpOnly/i);
    // The refresh cookie must only ever be sent to the auth endpoints.
    expect(refresh).toMatch(/Path=\/api\/auth/);
    // The CSRF cookie is readable by the SPA by design (double-submit).
    expect(csrf).not.toMatch(/HttpOnly/i);
  });

  it("an expired access token is rejected with 401", async () => {
    const { user } = await registerRaw(creds("expired"));
    const { signAccessToken } = await import("../src/utils/tokens.js");
    const expired = signAccessToken(user.id, -60);
    const r = await request(app).get("/api/users/me").set("Cookie", `cc_access=${expired}`);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHORIZED");
  });
});

// ---------- error surface ----------

describe("error handling (Phase 7)", () => {
  it("malformed JSON returns a 400 JSON envelope (not a 500, no stack)", async () => {
    const r = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send('{"name": "broken", ');
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\(|node_modules|SyntaxError/);
  });

  it("an oversized JSON body returns 413 PAYLOAD_TOO_LARGE as JSON", async () => {
    const big = `{"name":"${"x".repeat(2_100_000)}"}`;
    const r = await request(app).post("/api/auth/register").set("Content-Type", "application/json").send(big);
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("unknown /api routes return the 404 envelope with a requestId", async () => {
    const r = await request(app).get("/api/definitely-not-a-route");
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
    expect(r.body.error.code).toBe("NOT_FOUND");
    expect(r.body.requestId).toBeTruthy();
    expect(r.headers["x-request-id"]).toBeTruthy();
  });

  it("an unexpected internal failure returns the generic 500 envelope without internal details", async () => {
    const { createApp } = await import("../src/app.js");
    const { createMemoryRepos } = await import("./memoryRepos.js");
    const mem = createMemoryRepos();
    const app2 = createApp(mem);
    const agent = request.agent(app2);
    const csrfRes = await agent.get("/api/auth/csrf");
    const csrf = csrfRes.body.data.csrfToken as string;
    const reg = await agent.post("/api/auth/register").set("x-csrf-token", csrf).send(creds("boom"));
    expect(reg.status).toBe(201);
    const original = mem.users.findById;
    mem.users.findById = async () => {
      throw new Error("boom-secret-internal-detail");
    };
    try {
      const r = await agent.get("/api/users/me");
      expect(r.status).toBe(500);
      expect(r.body.error.code).toBe("INTERNAL");
      expect(r.body.error.message).toBe("Internal server error");
      expect(JSON.stringify(r.body)).not.toContain("boom-secret-internal-detail");
    } finally {
      mem.users.findById = original;
    }
  });
});

// ---------- readiness ----------

describe("readiness probe (Phase 7)", () => {
  it("GET /api/health/ready is 200 with db up against the live app", async () => {
    const r = await request(app).get("/api/health/ready");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ready");
    expect(r.body.db).toBe("up");
  });

  it("GET /api/health/ready is 503 when the database ping fails", async () => {
    const { createApp } = await import("../src/app.js");
    const { createMemoryRepos } = await import("./memoryRepos.js");
    const mem = createMemoryRepos();
    const appDown = createApp({ ...mem, ping: async () => false });
    const r = await request(appDown).get("/api/health/ready");
    expect(r.status).toBe(503);
    expect(r.body.status).toBe("not_ready");
    expect(r.body.db).toBe("down");
    // Liveness stays up even when readiness fails.
    const live = await request(appDown).get("/health");
    expect(live.status).toBe(200);
  });
});

// ---------- file guards ----------

describe("file guards (Phase 7)", () => {
  it("rejects file content above the 1,000,000-character cap with 400", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const r = await mutate(owner, "post", `/api/projects/${project.id}/files`, {
      name: "big.txt",
      type: "FILE",
      content: "x".repeat(1_000_001),
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("renaming a file onto a sibling's path conflicts with 409", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const a = await mutate(owner, "post", `/api/projects/${project.id}/files`, { name: "a.ts", type: "FILE", content: "a" });
    expect(a.status).toBe(201);
    const b = await mutate(owner, "post", `/api/projects/${project.id}/files`, { name: "b.ts", type: "FILE", content: "b" });
    expect(b.status).toBe(201);
    const renamed = await mutate(owner, "patch", `/api/files/${b.body.data.id}`, { name: "a.ts" });
    expect(renamed.status).toBe(409);
    expect(renamed.body.error.code).toBe("CONFLICT");
  });

  it("moving a folder into its own descendant is rejected with 400", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const folder = await mutate(owner, "post", `/api/projects/${project.id}/files`, { name: "outer", type: "FOLDER" });
    expect(folder.status).toBe(201);
    const sub = await mutate(owner, "post", `/api/projects/${project.id}/files`, {
      name: "inner",
      type: "FOLDER",
      parentId: folder.body.data.id,
    });
    expect(sub.status).toBe(201);
    const moved = await mutate(owner, "patch", `/api/files/${folder.body.data.id}`, { parentId: sub.body.data.id });
    expect(moved.status).toBe(400);
    expect(moved.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ---------- chat websocket hardening ----------

interface Frame {
  type: string;
  [k: string]: unknown;
}

function collectFrames(ws: WebSocket): { frames: Frame[]; waitFor: (pred: (f: Frame) => boolean, ms?: number) => Promise<Frame> } {
  const frames: Frame[] = [];
  const waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  ws.on("message", (data) => {
    try {
      const frame = JSON.parse(data.toString()) as Frame;
      frames.push(frame);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.pred(frame)) {
          waiters[i]!.resolve(frame);
          waiters.splice(i, 1);
        }
      }
    } catch {
      /* non-JSON frames are not part of the protocol */
    }
  });
  return {
    frames,
    waitFor: (pred, ms = 6000) =>
      new Promise<Frame>((resolve, reject) => {
        const existing = frames.find(pred);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), ms);
        waiters.push({
          pred,
          resolve: (f) => {
            clearTimeout(timer);
            resolve(f);
          },
        });
      }),
  };
}

function connectChat(cookie: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase, { headers: { Cookie: cookie, ...headers } });
    openSockets.add(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

describe("chat websocket hardening (Phase 7)", () => {
  it("rejects a WebSocket upgrade from a foreign Origin (CSWSH)", async () => {
    const { cookie } = await registerRaw(creds("cswsh"));
    const outcome = await new Promise<{ opened: boolean; status?: number }>((resolve) => {
      const ws = new WebSocket(wsBase, { headers: { Cookie: cookie, Origin: "https://evil.example.com" } });
      openSockets.add(ws);
      const timer = setTimeout(() => resolve({ opened: false }), 5000);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve({ opened: true });
      });
      ws.once("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        resolve({ opened: false, status: res.statusCode });
      });
      ws.once("error", () => {
        clearTimeout(timer);
        resolve({ opened: false });
      });
    });
    expect(outcome.opened).toBe(false);
    expect(outcome.status).toBe(403);
  });

  it("accepts an allow-listed Origin and a no-Origin client", async () => {
    const { cookie } = await registerRaw(creds("origins"));
    const wsAllowed = await connectChat(cookie, { Origin: "http://localhost:5173" });
    expect(wsAllowed.readyState).toBe(WebSocket.OPEN);
    const wsNoOrigin = await connectChat(cookie);
    expect(wsNoOrigin.readyState).toBe(WebSocket.OPEN);
  });

  it("throttles a flooding socket: RATE_LIMITED frames, then close 4429", async () => {
    const { cookie } = await registerRaw(creds("flood"));
    const ws = await connectChat(cookie);
    const { waitFor } = collectFrames(ws);
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    // The gateway in this suite is configured with maxFrames=5 per window
    // and maxViolations=2: frames 6+ are violations, and the second
    // violation closes the socket. Ping frames count like any other frame.
    for (let i = 0; i < 12; i++) ws.send(JSON.stringify({ type: "ping" }));
    const limited = await waitFor((f) => f.type === "error" && f.code === "RATE_LIMITED");
    expect(limited.code).toBe("RATE_LIMITED");
    const code = await closed;
    expect(code).toBe(4429);
  });

  it("closes the socket with 1009 when a frame exceeds the max payload", async () => {
    const { cookie } = await registerRaw(creds("bigframe"));
    const ws = await connectChat(cookie);
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send("x".repeat(64 * 1024));
    const code = await closed;
    expect(code).toBe(1009);
  });
});
