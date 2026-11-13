#!/usr/bin/env node
/** Copies the generated Prisma client into dist/ (tsc does not emit .js files it did not compile). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(appDir, "src", "generated");
const dest = path.join(appDir, "dist", "generated");
if (fs.existsSync(src)) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log("copied src/generated -> dist/generated");
}
