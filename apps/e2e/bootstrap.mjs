/**
 * E2E infrastructure bootstrap, run as the FIRST Playwright webServer
 * entry (Playwright starts web servers before any global setup, so the
 * database bootstrap lives here instead).
 *
 * Two database modes:
 *  - Embedded (default, local): starts a DEDICATED embedded PostgreSQL
 *    (own data dir + port 55435, via the API's dev-db helper — the
 *    sandbox has no Docker), creates the `collabcode_e2e` database.
 *    The embedded path drives initdb/pg_ctl as the `postgres` system
 *    user, so it requires root.
 *  - External (CI): when CC_E2E_DATABASE_URL is set, the embedded
 *    Postgres is skipped entirely and that database is used as-is
 *    (GitHub-hosted runners provide a Postgres service container and
 *    are not root). playwright.config.ts reads the same variable for
 *    the API/collaboration server env, so both sides agree.
 *
 * Either way the committed Prisma migrations are applied and every
 * workspace app is built. Then this serves HTTP 200 on port 5999, which
 * is the readiness signal Playwright waits for before running tests.
 * On SIGTERM (Playwright shutting the servers down) it stops Postgres
 * (embedded mode only).
 */
import { execSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const apiDir = path.join(repoRoot, "apps/api");
const EXTERNAL_DATABASE_URL = process.env.CC_E2E_DATABASE_URL;
const DATABASE_URL = EXTERNAL_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55435/collabcode_e2e?schema=public";
const pgEnv = { ...process.env, COLLABCODE_PG_DIR: process.env.COLLABCODE_E2E_PG_DIR ?? "/tmp/collabcode-pg-e2e", COLLABCODE_PG_PORT: "55435" };

function run(command, cwd, env, ignoreFailure = false) {
  try {
    execSync(command, { cwd, env, stdio: "inherit" });
  } catch (err) {
    if (!ignoreFailure) throw err;
  }
}

if (EXTERNAL_DATABASE_URL) {
  console.log("[e2e bootstrap] CC_E2E_DATABASE_URL set — using external PostgreSQL, embedded Postgres skipped");
} else {
  run("node scripts/dev-db.mjs start", apiDir, pgEnv, true);
  run("node scripts/dev-db.mjs createdb collabcode_e2e", apiDir, pgEnv, true);
}
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
  if (!EXTERNAL_DATABASE_URL) {
    try {
      execSync("node scripts/dev-db.mjs stop", { cwd: apiDir, env: pgEnv, stdio: "ignore" });
    } catch {
      /* best effort */
    }
  }
  process.exit(0);
});
