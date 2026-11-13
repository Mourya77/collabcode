import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vitest global setup — database strategy for the API test suite.
 *
 * Preferred mode (verified in the authoring sandbox): boot a REAL PostgreSQL
 * from the embedded-postgres binaries (scripts/dev-db.mjs), create
 * `collabcode_test`, and apply the committed migrations with
 * `prisma migrate deploy`. The connection string is written to .test-db.json
 * and the integration tests run against that database.
 *
 * Fallback mode: if the database cannot be started, .test-db.json records
 * mode "memory" and the integration tests run against the in-memory repository
 * implementation instead — always labelled, never silently.
 */
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Database selection: by default the suite boots its own embedded
 * PostgreSQL (port 55433). When CC_TEST_DATABASE_URL is set (CI provides a
 * Postgres service container), the suite uses that database instead —
 * migrations are still applied here, and any failure is FATAL (no silent
 * memory fallback in CI).
 */
const externalUrl = process.env.CC_TEST_DATABASE_URL;
export const TEST_DB_URL = externalUrl ?? "postgresql://postgres:postgres@127.0.0.1:55433/collabcode_test?schema=public";
const marker = path.join(apiDir, ".test-db.json");

export default async function setup(): Promise<() => Promise<void>> {
  fs.rmSync(marker, { force: true });
  let booted = false;
  try {
    if (!externalUrl) {
      execSync("node scripts/dev-db.mjs start", { cwd: apiDir, stdio: "pipe" });
      execSync("node scripts/dev-db.mjs createdb collabcode_test", { cwd: apiDir, stdio: "pipe" });
      booted = true;
    }
    execSync("node_modules/.bin/prisma migrate deploy", {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    });
    fs.writeFileSync(marker, JSON.stringify({ mode: "postgres", databaseUrl: TEST_DB_URL }, null, 2));
    console.log(
      externalUrl
        ? "[api tests] DB mode: REAL PostgreSQL (external CC_TEST_DATABASE_URL) — migrations applied via `prisma migrate deploy`"
        : "[api tests] DB mode: REAL PostgreSQL (embedded binaries) — migrations applied via `prisma migrate deploy`",
    );
  } catch (e) {
    if (externalUrl) throw e; // CI: an unavailable provided database is a hard failure.
    const msg = e instanceof Error ? e.message : String(e);
    fs.writeFileSync(marker, JSON.stringify({ mode: "memory", error: msg.slice(0, 400) }, null, 2));
    console.warn(`[api tests] DB mode: MEMORY FALLBACK (database unavailable) — ${msg.slice(0, 200)}`);
  }
  return async () => {
    if (booted && process.env.CC_TEST_DB_KEEP !== "1") {
      try {
        execSync("node scripts/dev-db.mjs stop", { cwd: apiDir, stdio: "ignore" });
      } catch {
        /* best effort */
      }
    }
  };
}
