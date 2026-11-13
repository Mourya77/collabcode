import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { Runner } from "../src/runners/types.js";

/**
 * Phase 7 — execution service error-surface regressions.
 *
 * Before Phase 7, body-parser failures fell through to Express's default
 * error handler (an HTML page, with a stack trace outside production) and
 * runner exceptions echoed their internal message to the caller. These
 * tests pin the JSON-only, leak-free surface.
 */

const TOKEN = "<MASKED_SECRET_004>";

const okRunner: Runner = {
  kind: "subprocess",
  async run() {
    return { status: "COMPLETED", stdout: "ok", stderr: "", exitCode: 0, durationMs: 1 };
  },
};

const explodingRunner: Runner = {
  kind: "subprocess",
  async run() {
    throw new Error("docker daemon at /var/run/docker.sock exploded with host path /srv/secret");
  },
};

describe("execution error surface (Phase 7)", () => {
  it("malformed JSON returns a 400 JSON envelope, not an HTML error page", async () => {
    const app = createApp({ runner: okRunner, internalToken: TOKEN });
    const r = await request(app)
      .post("/execute")
      .set("x-internal-token", TOKEN)
      .set("Content-Type", "application/json")
      .send('{"executionId": "x", ');
    expect(r.status).toBe(400);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(r.body)).not.toMatch(/<html|SyntaxError|at .*\(/);
  });

  it("an oversized body returns 413 PAYLOAD_TOO_LARGE as JSON", async () => {
    const app = createApp({ runner: okRunner, internalToken: TOKEN });
    const big = `{"executionId":"${"x".repeat(2_100_000)}"}`;
    const r = await request(app)
      .post("/execute")
      .set("x-internal-token", TOKEN)
      .set("Content-Type", "application/json")
      .send(big);
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("a runner exception returns a generic 500 without internal details", async () => {
    const app = createApp({ runner: explodingRunner, internalToken: TOKEN });
    const r = await request(app)
      .post("/execute")
      .set("x-internal-token", TOKEN)
      .send({
        executionId: "job-leak-check",
        language: "javascript",
        files: [{ path: "main.js", content: "console.log(1)" }],
        entryPoint: "main.js",
      });
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("INTERNAL");
    expect(r.body.error.message).toBe("Execution failed internally.");
    expect(JSON.stringify(r.body)).not.toContain("docker.sock");
    expect(JSON.stringify(r.body)).not.toContain("/srv/secret");
  });
});
