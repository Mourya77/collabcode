#!/usr/bin/env node
/**
 * Runs `prisma generate` for the collaboration schema.
 *
 * Sandbox note (same workaround as Phase 0–2): Prisma's Node-based engine
 * downloader fails through this sandbox's egress proxy (ECONNRESET), while
 * the engine binaries are already present in the workspace's @prisma/engines
 * package. When they are found, they are pinned via the PRISMA_*_BINARY /
 * PRISMA_QUERY_ENGINE_LIBRARY env vars so generate works fully offline.
 * On a normal network none of this is needed and plain `prisma generate`
 * behaves identically.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "../..");
const env = { ...process.env };
env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/collabcode?schema=public";

const store = path.join(repoRoot, "node_modules", ".pnpm");
if (!env.PRISMA_QUERY_ENGINE_LIBRARY && fs.existsSync(store)) {
  for (const entry of fs.readdirSync(store)) {
    if (!entry.startsWith("@prisma+engines@")) continue;
    const dir = path.join(store, entry, "node_modules", "@prisma", "engines");
    const lib = path.join(dir, "libquery_engine-debian-openssl-3.0.x.so.node");
    if (fs.existsSync(lib)) {
      env.PRISMA_QUERY_ENGINE_LIBRARY = lib;
      env.PRISMA_QUERY_ENGINE_BINARY = path.join(dir, "query-engine-debian-openssl-3.0.x");
      env.PRISMA_SCHEMA_ENGINE_BINARY = path.join(dir, "schema-engine-debian-openssl-3.0.x");
      break;
    }
  }
}

const prismaBin = path.join(appDir, "node_modules", ".bin", "prisma");
execFileSync(fs.existsSync(prismaBin) ? prismaBin : "prisma", ["generate"], {
  cwd: appDir,
  stdio: "inherit",
  env,
});
