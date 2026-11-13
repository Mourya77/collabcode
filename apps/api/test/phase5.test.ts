import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";

/**
 * Phase 5 tests: code executions.
 *
 * The REAL execution service (apps/execution) is spawned as a child process
 * on its default port 4002 with EXECUTION_RUNNER=subprocess (this sandbox
 * has no Docker daemon; the Docker runner is unit-tested in the execution
 * service's own suite). The API talks to it over HTTP with the shared
 * internal token, exactly as in production wiring.
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
let execChild: ChildProcess | null = null;
let execAlive = false;

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));
const execDir = fileURLToPath(new URL("../../execution", import.meta.url));

async function waitForExecHealth(timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch("http://127.0.0.1:4002/health");
      if (r.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - started > timeoutMs) throw new Error("execution service did not become healthy in time");
    await new Promise((r) => setTimeout(r, 200));
  }
}

function killExecService(): void {
  if (execChild?.pid) {
    try {
      process.kill(-execChild.pid, "SIGKILL");
    } catch {
      try {
        execChild.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  execChild = null;
  execAlive = false;
}

beforeAll(async () => {
  // Spawn the execution service FIRST so it is healthy before any run.
  execChild = spawn(path.join(execDir, "node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: execDir,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "4002",
      EXECUTION_RUNNER: "subprocess",
      EXECUTION_TIMEOUT_MS: "4000",
      EXECUTION_INTERNAL_TOKEN: "<MASKED_SECRET_002>",
    },
  });
  await waitForExecHealth();
  execAlive = true;

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
  console.log(`[phase5] running against DB mode: ${mode}`);
}, 120_000);

afterAll(() => {
  killExecService();
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

async function mutate(agent: Agent, method: "post" | "put" | "patch" | "delete", url: string, body?: unknown) {
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

async function createFileWithContent(agent: Agent, projectId: string, name: string, content: string) {
  const r = await mutate(agent, "post", `/api/projects/${projectId}/files`, { name, type: "FILE" });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const file = r.body.data as { id: string; path: string };
  const save = await mutate(agent, "patch", `/api/files/${file.id}`, { content });
  expect(save.status, JSON.stringify(save.body)).toBe(200);
  return file;
}

async function inviteAndAccept(owner: Agent, invitee: Agent, projectId: string, email: string, role: "EDITOR" | "VIEWER") {
  const r = await mutate(owner, "post", `/api/projects/${projectId}/invitations`, { email, role });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const inviteUrl = (r.body.data as { inviteUrl: string }).inviteUrl;
  const token = inviteUrl.split("/invite/")[1] as string;
  const acc = await mutate(invitee, "post", `/api/invitations/${token}/accept`);
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
}

function runExecution(agent: Agent, projectId: string, body: unknown) {
  return mutate(agent, "post", `/api/projects/${projectId}/executions`, body);
}

// ---------- tests ----------

describe("executions (Phase 5)", () => {
  it("EDITOR runs a JavaScript file end-to-end; result persisted and readable by its creator", async () => {
    const owner = request.agent(app);
    const me = await mustRegister(owner);
    const project = await createProject(owner);
    const file = await createFileWithContent(owner, project.id, "main.js", "console.log('api js hello');");

    const r = await runExecution(owner, project.id, { entryFileId: file.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const dto = r.body.data;
    expect(dto.status).toBe("COMPLETED");
    expect(dto.language).toBe("javascript");
    expect(dto.stdout).toContain("api js hello");
    expect(dto.exitCode).toBe(0);
    expect(typeof dto.executionTimeMs).toBe("number");

    const got = await owner.get(`/api/executions/${dto.id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.stdout).toContain("api js hello");

    const stored = await repos.executions.findById(dto.id as string);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.userId).toBe(me.id);
    expect(execAlive).toBe(true);
  });

  it("runs Python and C++ project files", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const py = await createFileWithContent(owner, project.id, "main.py", "print('api py hello')");
    const cpp = await createFileWithContent(
      owner,
      project.id,
      "main.cpp",
      "#include <cstdio>\nint main(){ std::printf(\"api cpp hello\\n\"); return 0; }",
    );

    const rpy = await runExecution(owner, project.id, { entryFileId: py.id });
    expect(rpy.status, JSON.stringify(rpy.body)).toBe(201);
    expect(rpy.body.data.status).toBe("COMPLETED");
    expect(rpy.body.data.language).toBe("python");
    expect(rpy.body.data.stdout).toContain("api py hello");

    const rcpp = await runExecution(owner, project.id, { entryFileId: cpp.id });
    expect(rcpp.status, JSON.stringify(rcpp.body)).toBe(201);
    expect(rcpp.body.data.status).toBe("COMPLETED");
    expect(rcpp.body.data.language).toBe("cpp");
    expect(rcpp.body.data.stdout).toContain("api cpp hello");
  });

  it("uses live editor content from files[] over the saved version", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const file = await createFileWithContent(owner, project.id, "main.js", "console.log('saved version');");

    const r = await runExecution(owner, project.id, {
      entryFileId: file.id,
      files: [{ fileId: file.id, content: "console.log('live editor');" }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe("COMPLETED");
    expect(r.body.data.stdout).toContain("live editor");
    expect(r.body.data.stdout).not.toContain("saved version");
  });

  it("VIEWER may not execute (403); non-member gets 404", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const viewer = request.agent(app);
    const viewerUser = await mustRegister(viewer, creds("viewer"));
    const stranger = request.agent(app);
    await mustRegister(stranger, creds("stranger"));
    const project = await createProject(owner);
    const file = await createFileWithContent(owner, project.id, "main.js", "console.log(1);");
    await inviteAndAccept(owner, viewer, project.id, viewerUser.email, "VIEWER");

    const byViewer = await runExecution(viewer, project.id, { entryFileId: file.id });
    expect(byViewer.status).toBe(403);

    const byStranger = await runExecution(stranger, project.id, { entryFileId: file.id });
    expect(byStranger.status).toBe(404);
  });

  it("executions are creator-only: another project member gets 404 on GET", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const editor = request.agent(app);
    const editorUser = await mustRegister(editor, creds("editor"));
    const project = await createProject(owner);
    const file = await createFileWithContent(owner, project.id, "main.js", "console.log('mine');");
    await inviteAndAccept(owner, editor, project.id, editorUser.email, "EDITOR");

    const r = await runExecution(owner, project.id, { entryFileId: file.id });
    expect(r.status).toBe(201);
    const id = r.body.data.id as string;

    const byEditor = await editor.get(`/api/executions/${id}`);
    expect(byEditor.status).toBe(404);
    const cancelByEditor = await mutate(editor, "post", `/api/executions/${id}/cancel`);
    expect(cancelByEditor.status).toBe(404);
  });

  it("rejects an unsupported entry file (.md) with 400 UNSUPPORTED_LANGUAGE", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const md = await createFileWithContent(owner, project.id, "README.md", "# hi");

    const r = await runExecution(owner, project.id, { entryFileId: md.id });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("UNSUPPORTED_LANGUAGE");
  });

  it("an infinite loop ends as TIMEOUT via the execution service", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const file = await createFileWithContent(owner, project.id, "loop.js", "while (true) {}");

    const started = Date.now();
    const r = await runExecution(owner, project.id, { entryFileId: file.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("cancel stops a long-running execution promptly and persists CANCELLED", async () => {
    const owner = request.agent(app);
    const me = await mustRegister(owner);
    const project = await createProject(owner);
    const file = await createFileWithContent(owner, project.id, "sleep.py", "import time\ntime.sleep(30)\nprint('done')");

    const started = Date.now();
    const csrf = await syncCsrf(owner);
    // Force-send the (lazy) supertest request, then cancel while it runs.
    const pending = owner
      .post(`/api/projects/${project.id}/executions`)
      .set("x-csrf-token", csrf)
      .send({ entryFileId: file.id })
      .then((r) => r);

    // Discover the RUNNING row for this user.
    let executionId: string | null = null;
    for (let i = 0; i < 80 && !executionId; i += 1) {
      const rows = await repos.executions.listForUser(me.id);
      const running = rows.find((row) => row.status === "RUNNING");
      if (running) executionId = running.id;
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(executionId).toBeTruthy();

    const cancel = await mutate(owner, "post", `/api/executions/${executionId}/cancel`);
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELLED");

    const finished = await pending;
    expect(finished.status).toBe(201);
    expect(finished.body.data.status).toBe("CANCELLED");
    expect(Date.now() - started).toBeLessThan(15_000);

    const again = await mutate(owner, "post", `/api/executions/${executionId}/cancel`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("EXECUTION_NOT_RUNNING");
  });

  it("records an honest FAILED when the execution service is down", async () => {
    const owner = request.agent(app);
    await mustRegister(owner);
    const project = await createProject(owner);
    const file = await createFileWithContent(owner, project.id, "main.js", "console.log(1);");

    killExecService();
    await new Promise((r) => setTimeout(r, 300));

    const r = await runExecution(owner, project.id, { entryFileId: file.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe("FAILED");
    expect(r.body.data.stderr).toContain("Execution service unavailable");
  });
});
