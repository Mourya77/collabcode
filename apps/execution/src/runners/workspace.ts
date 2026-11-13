import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JobFile } from "./types.js";

/**
 * Creates a fresh temporary workspace containing the job's files and returns
 * its absolute path. Paths are validated before this is called (see
 * validation.ts); the join+prefix check here is defence in depth.
 * Callers MUST pass the returned path to cleanupWorkspace() in a finally.
 */
export async function createWorkspace(files: JobFile[], baseDir?: string): Promise<string> {
  const parent = baseDir ?? os.tmpdir();
  await fs.promises.mkdir(parent, { recursive: true });
  const dir = await fs.promises.mkdtemp(path.join(parent, "cc-exec-"));
  try {
    for (const file of files) {
      const target = path.join(dir, file.path);
      if (!target.startsWith(dir + path.sep)) {
        throw new Error(`Refusing to write outside the job workspace: ${file.path}`);
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, file.content, "utf8");
    }
    // The C++ adapter compiles into .build/ inside the workspace.
    await fs.promises.mkdir(path.join(dir, ".build"), { recursive: true });
  } catch (e) {
    await cleanupWorkspace(dir);
    throw e;
  }
  return dir;
}

export async function cleanupWorkspace(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
