import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { makeHealth, makeApiError } from "@collabcode/shared";
import { env, type Env } from "./config/env.js";
import { isLanguageId } from "./languages.js";
import { logger } from "./logger.js";
import { JobRegistry } from "./jobs.js";
import { DockerRunner } from "./runners/docker.js";
import { SubprocessRunner } from "./runners/subprocess.js";
import type { ExecuteJob, Runner } from "./runners/types.js";
import { isSafeRelativePath, MAX_FILES, MAX_TOTAL_BYTES } from "./validation.js";

/**
 * Execution service HTTP surface.
 *
 * This service is INTERNAL-ONLY: it is called exclusively by the public API
 * (apps/api), which authenticates users, checks project roles, persists
 * Execution rows and owns cancellation state. Every route except GET /health
 * requires the x-internal-token header. User code is never executed in this
 * process — it runs in a disposable Docker container (production) or, in
 * dev/test only, a host subprocess (see runners/).
 */

export interface AppOptions {
  runner?: Runner;
  internalToken?: string;
  maxConcurrent?: number;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  config?: Env;
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const executeSchema = z.object({
  executionId: z.string().min(1).max(128),
  language: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .min(1)
    .max(MAX_FILES),
  entryPoint: z.string().min(1),
  stdin: z.string().max(65_536).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
});

export function createApp(opts: AppOptions = {}) {
  const config = opts.config ?? env;
  const internalToken = opts.internalToken ?? config.EXECUTION_INTERNAL_TOKEN;
  const maxOutputBytes = config.EXECUTION_MAX_OUTPUT_KB * 1024;
  const runner: Runner =
    opts.runner ??
    (config.EXECUTION_RUNNER === "subprocess"
      ? new SubprocessRunner({
          memoryMb: config.EXECUTION_MEMORY_MB,
          maxOutputBytes,
          workspacesDir: config.EXECUTION_WORKSPACES_DIR,
        })
      : new DockerRunner({
          memoryMb: config.EXECUTION_MEMORY_MB,
          maxOutputBytes,
          workspacesDir: config.EXECUTION_WORKSPACES_DIR,
        }));
  const registry = new JobRegistry(opts.maxConcurrent ?? config.EXECUTION_MAX_CONCURRENT);
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? config.EXECUTION_TIMEOUT_MS;
  const maxTimeoutMs = opts.maxTimeoutMs ?? 30_000;

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ...makeHealth("execution"), runner: runner.kind, activeJobs: registry.activeCount });
  });

  const requireInternalToken = (req: Request, res: Response, next: NextFunction): void => {
    if (!tokenMatches(req.header("x-internal-token"), internalToken)) {
      res.status(401).json(makeApiError("UNAUTHORIZED", "Missing or invalid internal token."));
      return;
    }
    next();
  };

  app.post("/execute", requireInternalToken, async (req, res) => {
    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(makeApiError("VALIDATION_ERROR", "Invalid execute request", parsed.error.flatten()));
      return;
    }
    const body = parsed.data;
    if (!isLanguageId(body.language)) {
      res
        .status(400)
        .json(makeApiError("VALIDATION_ERROR", `Unsupported language "${body.language}". Supported: javascript, python, cpp.`));
      return;
    }
    // Path safety + aggregate limits (defence in depth behind the API's own checks).
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const file of body.files) {
      if (!isSafeRelativePath(file.path)) {
        res.status(400).json(makeApiError("VALIDATION_ERROR", `Unsafe file path: "${file.path}".`));
        return;
      }
      if (seen.has(file.path)) {
        res.status(400).json(makeApiError("VALIDATION_ERROR", `Duplicate file path: "${file.path}".`));
        return;
      }
      seen.add(file.path);
      totalBytes += Buffer.byteLength(file.content, "utf8");
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      res.status(400).json(makeApiError("VALIDATION_ERROR", `Total source size exceeds ${MAX_TOTAL_BYTES} bytes.`));
      return;
    }
    if (!seen.has(body.entryPoint)) {
      res.status(400).json(makeApiError("VALIDATION_ERROR", "entryPoint must be one of the submitted file paths."));
      return;
    }
    const executionId = body.executionId;
    if (!registry.tryAcquire(executionId)) {
      res.status(429).json(makeApiError("EXECUTION_BUSY", "Execution service is at capacity. Please retry shortly."));
      return;
    }

    let responded = false;
    // If the caller (the API) hangs up mid-run, kill the job — nobody is
    // waiting for its result, and it must not keep burning resources.
    res.on("close", () => {
      if (!responded) registry.kill(executionId, "client-disconnect");
    });

    const job: ExecuteJob = {
      executionId,
      language: body.language,
      files: body.files,
      entryPoint: body.entryPoint,
      stdin: body.stdin,
      timeoutMs: Math.min(body.timeoutMs ?? defaultTimeoutMs, maxTimeoutMs),
    };
    logger.info("execute.started", { executionId, language: body.language, files: body.files.length });
    try {
      const result = await runner.run(job, {
        registerKill: (kill) => registry.registerKill(executionId, kill),
      });
      responded = true;
      logger.info("execute.finished", {
        executionId,
        language: body.language,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });
      res.json({
        executionId,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        ...(result.phase ? { phase: result.phase } : {}),
        ...(result.terminationReason ? { terminationReason: result.terminationReason } : {}),
      });
    } catch (e) {
      responded = true;
      // The raw error is logged server-side only (Phase 7): internal runner
      // messages (paths, docker stderr) must not leak to callers.
      logger.error("execute.internal_error", {
        executionId,
        error: e instanceof Error ? e.message : String(e),
      });
      res.status(500).json(makeApiError("INTERNAL", "Execution failed internally."));
    } finally {
      registry.release(executionId);
    }
  });

  app.post("/execute/:executionId/cancel", requireInternalToken, (req, res) => {
    const killed = registry.kill(req.params.executionId as string, "cancel");
    if (killed) logger.info("execute.cancelled", { executionId: req.params.executionId });
    if (!killed) {
      res.status(404).json(makeApiError("NOT_FOUND", "No running execution with that id."));
      return;
    }
    res.json({ cancelled: true, executionId: req.params.executionId });
  });

  app.use((_req, res) => {
    res.status(404).json(makeApiError("NOT_FOUND", "Route not found"));
  });

  // Body-parser failures must stay on the JSON error surface (Phase 7) —
  // Express's default handler returns an HTML page (with a stack trace
  // outside production).
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    const bp = err as { status?: unknown; type?: unknown };
    if (bp.type === "entity.parse.failed" || (err instanceof SyntaxError && bp.status === 400)) {
      res.status(400).json(makeApiError("VALIDATION_ERROR", "Malformed JSON in request body."));
      return;
    }
    if (bp.type === "entity.too.large" || bp.status === 413) {
      res.status(413).json(makeApiError("PAYLOAD_TOO_LARGE", "Request body is too large."));
      return;
    }
    logger.error("request.unhandled_error", { error: err.message });
    if (!res.headersSent) res.status(500).json(makeApiError("INTERNAL", "Internal server error."));
    else next(err);
  });
  return app;
}

export const app = createApp();
