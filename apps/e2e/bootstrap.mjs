/**
 * E2E infrastructure bootstrap, run as the FIRST Playwright webServer
 * entry (Playwright starts web servers before any global setup, so the
 * database bootstrap lives here instead).
 *
 * Starts a DEDICATED embedded PostgreSQL (own data dir + port 55435, via
 * the API's dev-db helper — the sandbox has no Docker), creates the
 * `collabcode_e2e` database, applies the committed Prisma migrations, and
 * builds every workspace app. Then it serves HTTP 200 on port 5999, which
 * is the readiness signal Playwright waits for before running tests.
 * On SIGTERM (Playwright shutting the servers down) it stops Postgres.
 */
import { execSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const apiDir = path.join(repoRoot, "apps/api");
const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55435/collabcode_e2e?schema=public";
const pgEnv = { ...process.env, COLLABCODE_PG_DIR: process.env.COLLABCODE_E2E_PG_DIR ?? "/tmp/collabcode-pg-e2e", COLLABCODE_PG_PORT: "55435" };

function run(command, cwd, env, ignoreFailure = false) {
  try {
    execSync(command, { cwd, env, stdio: "inherit" });
  } catch (err) {
    if (!ignoreFailure) throw err;
  }
}

run("node scripts/dev-db.mjs start", apiDir, pgEnv, true);
run("node scripts/dev-db.mjs createdb collabcode_e2e", apiDir, pgEnv, true);
run("node_modules/.bin/prisma migrate deploy", apiDir, { ...process.env, DATABASE_URL });
run("pnpm -r build", repoRoot, process.env);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ready");
});
server.listen(5999, "127.0.0.1", () => {
  console.log("[e2e bootstrap] infrastructure ready on :5999");
});

process.on("SIGTERM", () => {
  try {
    execSync("node scripts/dev-db.mjs stop", { cwd: apiDir, env: pgEnv, stdio: "ignore" });
  } catch {
    /* best effort */
  }
  process.exit(0);
});
