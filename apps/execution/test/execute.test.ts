import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { LANGUAGES } from "../src/languages.js";
import { buildDockerArgs } from "../src/runners/docker.js";
import { SubprocessRunner } from "../src/runners/subprocess.js";
import type { ExecuteJob } from "../src/runners/types.js";

/**
 * Execution service tests.
 *
 * Unit tests pin the Docker runner's security contract (pure argv builder)
 * and the env guards. Integration tests execute real programs through the
 * DEV-ONLY subprocess runner (node / python3 / g++ on this machine) — the
 * Docker path cannot run here (no daemon in the sandbox) and is covered by
 * the argv unit tests only. That limitation is deliberate and documented.
 */

const TOKEN = "<MASKED_SECRET_003>";
let workspacesDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  workspacesDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cc-exec-test-"));
  app = createApp({
    runner: new SubprocessRunner({ memoryMb: 256, maxOutputBytes: 64 * 1024, workspacesDir }),
    internalToken: TOKEN,
    defaultTimeoutMs: 5_000,
  });
});

afterAll(async () => {
  await fs.promises.rm(workspacesDir, { recursive: true, force: true });
});

function execute(body: Record<string, unknown>, token: string | null = TOKEN) {
  let req = request(app).post("/execute");
  if (token !== null) req = req.set("x-internal-token", token);
  return req.send(body);
}

const jsJob = (content: string) => ({
  executionId: `job-${Math.random().toString(36).slice(2)}`,
  language: "javascript",
  files: [{ path: "main.js", content }],
  entryPoint: "main.js",
});

// ---------- unit: docker argv contract ----------

describe("buildDockerArgs (production security contract)", () => {
  const job: ExecuteJob = {
    executionId: "abc",
    language: "javascript",
    files: [{ path: "main.js", content: "console.log(1)" }],
    entryPoint: "main.js",
    timeoutMs: 5_000,
  };

  it("pins every isolation flag", () => {
    const args = buildDockerArgs(job, "/tmp/ws-abc", "cc-exec-abc-run");
    const joined = args.join(" ");
    expect(args[0]).toBe("run");
    expect(joined).toContain("--rm");
    expect(joined).toContain("--network none");
    expect(joined).toContain("--memory 256m");
    expect(joined).toContain("--memory-swap 256m");
    expect(joined).toContain("--cpus 0.5");
    expect(joined).toContain("--pids-limit 64");
    expect(joined).toContain("--user 1000:1000");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("no-new-privileges");
    expect(joined).toContain("--read-only");
    expect(joined).toContain("--tmpfs /tmp:rw,size=32m");
    expect(joined).toContain("--ulimit core=0");
    expect(joined).toContain("-v /tmp/ws-abc:/workspace:rw");
    expect(joined).toContain("-w /workspace");
    // No privileged mode, no docker socket, no extra host mounts.
    expect(joined).not.toContain("--privileged");
    expect(joined).not.toContain("docker.sock");
    expect(args.filter((a) => a === "-v")).toHaveLength(1);
  });

  it("uses the fixed image per language and never a client-supplied one", () => {
    expect(buildDockerArgs(job, "/w", "n")).toContain("node:20-alpine");
    expect(buildDockerArgs({ ...job, language: "python", entryPoint: "main.py" }, "/w", "n")).toContain("python:3.12-alpine");
    const cppArgs = buildDockerArgs({ ...job, language: "cpp", entryPoint: "main.cpp" }, "/w", "n");
    expect(cppArgs).toContain("gcc:13-bookworm");
    expect(cppArgs.slice(-6)).toEqual(["g++", "-O2", "-std=c++17", "-o", ".build/app", "main.cpp"]);
  });

  it("language adapters expose compile+run steps only for C++", () => {
    expect(LANGUAGES.javascript.steps("main.js")).toEqual([{ phase: "run", argv: ["node", "main.js"] }]);
    expect(LANGUAGES.python.steps("a/b.py")).toEqual([{ phase: "run", argv: ["python3", "a/b.py"] }]);
    expect(LANGUAGES.cpp.steps("main.cpp").map((s) => s.phase)).toEqual(["compile", "run"]);
  });
});

// ---------- unit: env guards ----------

describe("env guards", () => {
  it("refuses the subprocess runner in production", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production", EXECUTION_RUNNER: "subprocess", EXECUTION_INTERNAL_TOKEN: "a-real-secret-123456" }),
    ).toThrow(/subprocess is forbidden in production/);
  });
  it("refuses the dev internal token in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production", EXECUTION_RUNNER: "docker" })).toThrow(/EXECUTION_INTERNAL_TOKEN/);
  });
});

// ---------- unit: auth + validation over HTTP ----------

describe("internal auth + validation", () => {
  it("GET /health is public", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.service).toBe("execution");
    expect(r.body.runner).toBe("subprocess");
  });

  it("rejects a missing internal token with 401", async () => {
    const r = await execute(jsJob("console.log(1)"), null);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a wrong internal token with 401", async () => {
    const r = await execute(jsJob("console.log(1)"), "wrong-token-value-123456");
    expect(r.status).toBe(401);
  });

  it("rejects an unknown language with 400", async () => {
    const r = await execute({ ...jsJob("x"), language: "ruby" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects path traversal in file paths with 400", async () => {
    const r = await execute({
      executionId: "trav",
      language: "javascript",
      files: [{ path: "../evil.js", content: "console.log(1)" }],
      entryPoint: "../evil.js",
    });
    expect(r.status).toBe(400);
  });

  it("rejects an entry point that is not one of the files with 400", async () => {
    const r = await execute({ ...jsJob("console.log(1)"), entryPoint: "other.js" });
    expect(r.status).toBe(400);
  });

  it("rejects a malformed body with 400", async () => {
    const r = await execute({ language: "javascript" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ---------- integration: real programs via the subprocess runner ----------

describe("program execution (subprocess runner, real runtimes)", () => {
  it("runs JavaScript and captures stdout", async () => {
    const r = await execute(jsJob("console.log('hello from js')"));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("COMPLETED");
    expect(r.body.stdout).toContain("hello from js");
    expect(r.body.exitCode).toBe(0);
    expect(typeof r.body.durationMs).toBe("number");
  });

  it("runs Python and captures stdout", async () => {
    const r = await execute({
      executionId: "py-hello",
      language: "python",
      files: [{ path: "main.py", content: "print('hello from python')" }],
      entryPoint: "main.py",
    });
    expect(r.body.status).toBe("COMPLETED");
    expect(r.body.stdout).toContain("hello from python");
  });

  it("compiles and runs C++", async () => {
    const r = await execute({
      executionId: "cpp-hello",
      language: "cpp",
      files: [{ path: "main.cpp", content: "#include <cstdio>\nint main(){ std::printf(\"hello from cpp\\n\"); return 0; }" }],
      entryPoint: "main.cpp",
    });
    expect(r.body.status).toBe("COMPLETED");
    expect(r.body.stdout).toContain("hello from cpp");
    expect(r.body.exitCode).toBe(0);
  });

  it("reports C++ compilation failures with phase=compile and the compiler message", async () => {
    const r = await execute({
      executionId: "cpp-bad",
      language: "cpp",
      files: [{ path: "main.cpp", content: "int main() { this is not valid C++ }" }],
      entryPoint: "main.cpp",
    });
    expect(r.body.status).toBe("FAILED");
    expect(r.body.phase).toBe("compile");
    expect(r.body.stderr).toMatch(/error/i);
  });

  it("reports JavaScript runtime errors with stderr", async () => {
    const r = await execute(jsJob("throw new Error('boom-runtime')"));
    expect(r.body.status).toBe("FAILED");
    expect(r.body.exitCode).not.toBe(0);
    expect(r.body.stderr).toContain("boom-runtime");
  });

  it("feeds stdin to the program", async () => {
    const r = await execute({
      executionId: "py-stdin",
      language: "python",
      files: [{ path: "main.py", content: "import sys\nprint('got:' + sys.stdin.read().strip())" }],
      entryPoint: "main.py",
      stdin: "hello-stdin",
    });
    expect(r.body.status).toBe("COMPLETED");
    expect(r.body.stdout).toContain("got:hello-stdin");
  });

  it("runs multi-file programs via the entry point", async () => {
    const r = await execute({
      executionId: "js-multi",
      language: "javascript",
      files: [
        { path: "main.js", content: "const {msg} = require('./lib/util.js'); console.log(msg);" },
        { path: "lib/util.js", content: "module.exports = { msg: 'from util' };" },
      ],
      entryPoint: "main.js",
    });
    expect(r.body.status).toBe("COMPLETED");
    expect(r.body.stdout).toContain("from util");
  });

  it("times out an infinite loop", async () => {
    const started = Date.now();
    const r = await execute({ ...jsJob("while (true) {}"), timeoutMs: 800 });
    expect(r.body.status).toBe("TIMEOUT");
    expect(r.body.terminationReason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("kills a memory hog instead of letting it complete", async () => {
    const hog = [
      "import time",
      "chunks = []",
      "while True:",
      "    chunks.append(bytearray(10 * 1024 * 1024))",
      "    time.sleep(0.01)",
    ].join("\n");
    const r = await execute({
      executionId: "py-hog",
      language: "python",
      files: [{ path: "main.py", content: hog }],
      entryPoint: "main.py",
      timeoutMs: 20_000,
    });
    expect(r.body.status).not.toBe("COMPLETED");
    expect(r.body.status).toBe("FAILED");
    expect(r.body.terminationReason).toBe("memory");
  });

  it("cancel kills an in-flight job promptly", async () => {
    const started = Date.now();
    // .then() forces supertest to actually send the (otherwise lazy) request.
    const pending = execute({ ...jsJob("while (true) {}"), executionId: "cancel-me", timeoutMs: 25_000 }).then((r) => r);
    await new Promise((r) => setTimeout(r, 600));
    const cancel = await request(app).post("/execute/cancel-me/cancel").set("x-internal-token", TOKEN);
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelled).toBe(true);
    const r = await pending;
    expect(r.body.status).toBe("TIMEOUT");
    expect(r.body.terminationReason).toBe("cancel");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("cancel of an unknown job returns 404", async () => {
    const r = await request(app).post("/execute/nope/cancel").set("x-internal-token", TOKEN);
    expect(r.status).toBe(404);
  });

  it("truncates very large output", async () => {
    const r = await execute(jsJob("process.stdout.write('x'.repeat(200 * 1024))"));
    expect(r.body.status).toBe("COMPLETED");
    expect(r.body.stdout).toContain("[output truncated]");
    expect(Buffer.byteLength(r.body.stdout, "utf8")).toBeLessThan(70 * 1024);
  });

  it("leaves no workspace directories behind", async () => {
    // Give async cleanup a brief moment, then assert.
    await new Promise((r) => setTimeout(r, 300));
    const entries = await fs.promises.readdir(workspacesDir);
    expect(entries.filter((e) => e.startsWith("cc-exec-"))).toEqual([]);
  });
});
