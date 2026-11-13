#!/usr/bin/env node
/**
 * Sandbox/dev helper: boots the PostgreSQL binaries bundled with the
 * `embedded-postgres` npm package WITHOUT Docker.
 *
 * Why: the authoring sandbox has no Docker and no system PostgreSQL, and the
 * embedded-postgres library cannot spawn its binaries as the `postgres` user
 * from the permission-locked workspace directory. This script copies the
 * binaries to a world-readable runtime dir (default /tmp/collabcode-pg) and
 * drives initdb/pg_ctl directly as the `postgres` user.
 *
 * On a normal dev machine you do NOT need this: use `docker compose up -d`
 * (Postgres 16) from the repo root instead.
 *
 * Usage:
 *   node scripts/dev-db.mjs start              # init (if needed) + start server
 *   node scripts/dev-db.mjs stop
 *   node scripts/dev-db.mjs status
 *   node scripts/dev-db.mjs createdb <name>    # idempotent
 *   node scripts/dev-db.mjs url <name>         # prints a DATABASE_URL
 *
 * Env: COLLABCODE_PG_DIR (runtime dir), COLLABCODE_PG_PORT (default 55433).
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiDir, "../..");
const DIR = process.env.COLLABCODE_PG_DIR ?? "/tmp/collabcode-pg";
const PORT = Number(process.env.COLLABCODE_PG_PORT ?? 55433);
const USER = "postgres";
const PASSWORD = "postgres";

function findNativeDir() {
  const store = path.join(repoRoot, "node_modules", ".pnpm");
  if (fs.existsSync(store)) {
    for (const entry of fs.readdirSync(store)) {
      if (entry.startsWith("@embedded-postgres+linux-x64@")) {
        const native = path.join(store, entry, "node_modules", "@embedded-postgres", "linux-x64", "native");
        if (fs.existsSync(path.join(native, "bin", "initdb"))) return native;
      }
    }
  }
  const direct = path.join(apiDir, "node_modules", "@embedded-postgres", "linux-x64", "native");
  if (fs.existsSync(path.join(direct, "bin", "initdb"))) return direct;
  throw new Error("embedded-postgres binaries not found — run `pnpm install` first.");
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "pipe", ...opts }).toString();
}
function asPostgres(bin, args) {
  return run("runuser", ["-u", USER, "--", bin, ...args]);
}
function isRunning() {
  try {
    asPostgres(path.join(DIR, "native", "bin", "pg_ctl"), ["-D", path.join(DIR, "data"), "status"]);
    return true;
  } catch {
    return false;
  }
}
function waitForPort(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(PORT, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("postgres did not start in time"));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function start() {
  const nativeTarget = path.join(DIR, "native");
  if (!fs.existsSync(path.join(nativeTarget, "bin", "initdb"))) {
    const src = findNativeDir();
    fs.mkdirSync(DIR, { recursive: true });
    execSync(`cp -r "${src}" "${nativeTarget}" && chmod -R a+rX "${DIR}"`);
  }
  const dataDir = path.join(DIR, "data");
  const runDir = path.join(DIR, "run");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  try { execSync(`chown -R ${USER}:${USER} "${dataDir}" "${runDir}"`); } catch { /* not root: best effort */ }
  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    const pwfile = path.join(DIR, "pwfile");
    fs.writeFileSync(pwfile, PASSWORD);
    fs.chmodSync(pwfile, 0o644); // initdb reads it as the postgres user
    asPostgres(path.join(nativeTarget, "bin", "initdb"), [
      "-D", dataDir, "-U", USER, "--auth=password", `--pwfile=${pwfile}`, "--lc-messages=C",
    ]);
  }
  if (!isRunning()) {
    asPostgres(path.join(nativeTarget, "bin", "pg_ctl"), [
      "-D", dataDir, "-o", `-p ${PORT} -h 127.0.0.1 -k ${runDir}`, "-l", path.join(runDir, "server.log"), "start",
    ]);
  }
  await waitForPort();
  console.log(`postgres up on 127.0.0.1:${PORT} (data: ${dataDir})`);
}

function stop() {
  if (isRunning()) {
    asPostgres(path.join(DIR, "native", "bin", "pg_ctl"), ["-D", path.join(DIR, "data"), "-m", "fast", "stop"]);
    console.log("postgres stopped");
  } else {
    console.log("postgres not running");
  }
}

async function createdb(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`invalid database name: ${name}`);
  const { PrismaClient } = await import("@prisma/client");
  const p = new PrismaClient({ datasourceUrl: `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/postgres` });
  try {
    await p.$executeRawUnsafe(`CREATE DATABASE ${name}`);
    console.log(`created database ${name}`);
  } catch (e) {
    if (String(e?.message ?? e).includes("already exists")) console.log(`database ${name} already exists`);
    else throw e;
  } finally {
    await p.$disconnect();
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "start") await start();
else if (cmd === "stop") stop();
else if (cmd === "status") console.log(isRunning() ? `running on 127.0.0.1:${PORT}` : "not running");
else if (cmd === "createdb") await createdb(arg ?? "collabcode_test");
else if (cmd === "url") console.log(`postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${arg ?? "collabcode_test"}?schema=public`);
else { console.error("usage: dev-db.mjs start|stop|status|createdb <name>|url <name>"); process.exit(1); }
