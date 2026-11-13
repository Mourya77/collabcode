import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Phase 8 tests: execution-disabled deployments.
 *
 * A production deployment WITHOUT a verified Docker-capable execution host
 * leaves EXECUTION_SERVICE_URL unset — the API must then refuse execution
 * requests with 503 EXECUTION_DISABLED and create NO execution record
 * (docs/deployment.md). An explicitly empty EXECUTION_SERVICE_URL disables
 * execution in any environment, which is how this suite exercises the HTTP
 * path: the variable is set BEFORE any src module is imported (the env
 * singleton is built at import time), and every src import below is dynamic.
 */

const PREV_EXEC_URL = process.env.EXECUTION_SERVICE_URL;
process.env.EXECUTION_SERVICE_URL = "";

let app: Express;
let repos: import("./memoryRepos.js").MemoryRepos;

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { createMemoryRepos } = await import("./memoryRepos.js");
  repos = createMemoryRepos();
  app = createApp(repos);
});

afterAll(() => {
  if (PREV_EXEC_URL === undefined) delete process.env.EXECUTION_SERVICE_URL;
  else process.env.EXECUTION_SERVICE_URL = PREV_EXEC_URL;
});

// ---------- helpers ----------

type Agent = ReturnType<typeof request.agent>;

async function syncCsrf(agent: Agent): Promise<string> {
  const r = await agent.get("/api/auth/csrf");
  expect(r.status).toBe(200);
  return r.body.data.csrfToken as string;
}

async function mutate(agent: Agent, method: "post" | "patch", url: string, body?: unknown) {
  const csrf = await syncCsrf(agent);
  let q = agent[method](url).set("x-csrf-token", csrf);
  if (body !== undefined) q = q.send(body as object);
  return q;
}

let seq = 0;
async function mustRegister(agent: Agent) {
  seq += 1;
  const c = { name: "Phase8 User", email: `phase8.${seq}@example.com`, password: "<MASKED_SECRET_003>" };
  const csrf = await syncCsrf(agent);
  const r = await agent.post("/api/auth/register").set("x-csrf-token", csrf).send(c);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; email: string; name: string };
}

// ---------- env semantics ----------

describe("execution-disabled env semantics (Phase 8)", () => {
  it("production without EXECUTION_SERVICE_URL disables execution", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    const e = loadEnv({
      NODE_ENV: "production",
      JWT_SECRET: "p".repeat(40),
      EXECUTION_INTERNAL_TOKEN: "q".repeat(24),
      COLLAB_INTERNAL_TOKEN: "r".repeat(24),
      DATABASE_URL: "postgresql://u:p@db.example.com:5432/collabcode",
    });
    expect(e.EXECUTION_ENABLED).toBe(false);
    expect(e.EXECUTION_SERVICE_URL).toBeNull();
  });

  it("production WITH EXECUTION_SERVICE_URL keeps execution enabled", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    const e = loadEnv({
      NODE_ENV: "production",
      JWT_SECRET: "p".repeat(40),
      EXECUTION_INTERNAL_TOKEN: "q".repeat(24),
      COLLAB_INTERNAL_TOKEN: "r".repeat(24),
      DATABASE_URL: "postgresql://u:p@db.example.com:5432/collabcode",
      EXECUTION_SERVICE_URL: "http://collabcode-execution.internal:4002",
    });
    expect(e.EXECUTION_ENABLED).toBe(true);
    expect(e.EXECUTION_SERVICE_URL).toBe("http://collabcode-execution.internal:4002");
  });

  it("outside production, unset keeps the localhost default; explicit empty disables", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    const dev = loadEnv({});
    expect(dev.EXECUTION_ENABLED).toBe(true);
    expect(dev.EXECUTION_SERVICE_URL).toBe("http://localhost:4002");
    const off = loadEnv({ NODE_ENV: "test", EXECUTION_SERVICE_URL: "" });
    expect(off.EXECUTION_ENABLED).toBe(false);
    expect(off.EXECUTION_SERVICE_URL).toBeNull();
  });
});

// ---------- HTTP behaviour ----------

describe("executions on a disabled deployment (Phase 8)", () => {
  it("POST /executions returns 503 EXECUTION_DISABLED and creates no record", async () => {
    const owner = request.agent(app);
    const me = await mustRegister(owner);
    const project = await mutate(owner, "post", "/api/projects", { name: "NoExec", description: "disabled deployment" });
    expect(project.status, JSON.stringify(project.body)).toBe(201);
    const projectId = (project.body.data as { id: string }).id;

    const fileRes = await mutate(owner, "post", `/api/projects/${projectId}/files`, { name: "main.py", type: "FILE" });
    expect(fileRes.status, JSON.stringify(fileRes.body)).toBe(201);
    const fileId = (fileRes.body.data as { id: string }).id;
    const save = await mutate(owner, "patch", `/api/files/${fileId}`, { content: "print('never runs')" });
    expect(save.status, JSON.stringify(save.body)).toBe(200);

    const r = await mutate(owner, "post", `/api/projects/${projectId}/executions`, { entryFileId: fileId });
    expect(r.status, JSON.stringify(r.body)).toBe(503);
    expect(r.body.error.code).toBe("EXECUTION_DISABLED");
    expect(r.body.error.message).toBe("Code execution is not enabled on this deployment");

    const stored = await repos.executions.listForUser(me.id, 100);
    expect(stored).toHaveLength(0);
  });

  it("disabled check takes precedence over language validation (still 503, still no record)", async () => {
    const owner = request.agent(app);
    const me = await mustRegister(owner);
    const project = await mutate(owner, "post", "/api/projects", { name: "NoExec2", description: "" });
    const projectId = (project.body.data as { id: string }).id;
    const fileRes = await mutate(owner, "post", `/api/projects/${projectId}/files`, { name: "notes.md", type: "FILE" });
    const fileId = (fileRes.body.data as { id: string }).id;

    const r = await mutate(owner, "post", `/api/projects/${projectId}/executions`, { entryFileId: fileId });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("EXECUTION_DISABLED");
    expect(await repos.executions.listForUser(me.id, 100)).toHaveLength(0);
  });
});
