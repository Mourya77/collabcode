import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vitest global setup for the collaboration suite.
 *
 * Boots a REAL PostgreSQL from the embedded-postgres binaries — a dedicated
 * instance (dir /tmp/collabcode-pg-collab, port 55434) so it never collides
 * with the API suite's instance (55433) — creates `collabcode_collab_test`,
 * applies the API's committed migrations (`prisma migrate deploy` against
 * apps/api/prisma/schema.prisma, the canonical schema), and generates this
 * service's own Prisma client. The mode is recorded in .test-db.json; the
 * integration tests REQUIRE mode "postgres" and fail loudly otherwise —
 * there is no in-memory fallback for CRDT/persistence tests, by design.
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.resolve(appDir, "../api");
/**
 * Database selection: by default the suite boots its own embedded
 * PostgreSQL (port 55434). When CC_COLLAB_TEST_DATABASE_URL is set (CI
 * provides a Postgres service container), that database is used instead;
 * migrations are still applied here and failures stay loud (this suite
 * has no fallback by design).
 */
export const TEST_DB_URL =
  process.env.CC_COLLAB_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55434/collabcode_collab_test?schema=public";
const externalUrl = process.env.CC_COLLAB_TEST_DATABASE_URL;
const marker = path.join(appDir, ".test-db.json");

const pgEnv = {
  ...process.env,
  COLLABCODE_PG_DIR: "/tmp/collabcode-pg-collab",
  COLLABCODE_PG_PORT: "55434",
};

export default async function setup(): Promise<() => Promise<void>> {
  fs.rmSync(marker, { force: true });
  let booted = false;
  try {
    execSync("node scripts/generate.mjs", { cwd: appDir, stdio: "pipe" });
    if (!externalUrl) {
      execSync("node scripts/dev-db.mjs start", { cwd: apiDir, stdio: "pipe", env: pgEnv });
      execSync("node scripts/dev-db.mjs createdb collabcode_collab_test", { cwd: apiDir, stdio: "pipe", env: pgEnv });
      booted = true;
    }
    execSync("node_modules/.bin/prisma migrate deploy --schema ../api/prisma/schema.prisma", {
      cwd: appDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    });
    fs.writeFileSync(marker, JSON.stringify({ mode: "postgres", databaseUrl: TEST_DB_URL }, null, 2));
    console.log(
      externalUrl
        ? "[collaboration tests] DB mode: REAL PostgreSQL (external CC_COLLAB_TEST_DATABASE_URL) — API migrations applied"
        : "[collaboration tests] DB mode: REAL PostgreSQL (embedded binaries, port 55434) — API migrations applied",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fs.writeFileSync(marker, JSON.stringify({ mode: "unavailable", error: msg.slice(0, 500) }, null, 2));
    console.warn(`[collaboration tests] DB unavailable: ${msg.slice(0, 300)}`);
  }
  return async () => {
    if (booted && process.env.CC_TEST_DB_KEEP !== "1") {
      try {
        execSync("node scripts/dev-db.mjs stop", { cwd: apiDir, stdio: "ignore", env: pgEnv });
      } catch {
        /* best effort */
      }
    }
  };
}
