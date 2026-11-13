import path from "node:path";
import { env } from "../../config/env.js";
import type { FileRecord, Repos } from "../../repositories/types.js";
import { ApiError, badRequest, notFound } from "../../utils/errors.js";
import { cancelOnExecutionService, runOnExecutionService } from "./client.js";
import { clearInflight, countInflightForUser, getInflight, registerInflight } from "./inflight.js";
import type { CreateExecutionInput } from "./schemas.js";
import { toExecutionDto, type ExecutionDto } from "./types.js";

/**
 * Language is derived SERVER-SIDE from the entry file's extension. Clients
 * cannot request a language (or an image, or runner options) — the set of
 * runnable languages is exactly the execution service's adapter set.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
};

const MAX_PROJECT_FILES = 50;

export function languageForFile(file: Pick<FileRecord, "name">): string | null {
  return LANGUAGE_BY_EXTENSION[path.extname(file.name).toLowerCase()] ?? null;
}

export class ExecutionsService {
  constructor(private readonly repos: Repos) {}

  /**
   * Creates and runs an execution. The caller's project role was already
   * enforced by middleware (EDITOR minimum; non-members got 404 there).
   * The request blocks until the run finishes (bounded by the execution
   * service's own timeout, ≤30s) and returns the persisted final state.
   */
  async create(
    userId: string,
    projectId: string,
    input: CreateExecutionInput,
    onCreated?: (executionId: string) => void,
  ): Promise<ExecutionDto> {
    // Phase 8 — deployments without a configured execution service (no
    // verified Docker host) run with execution disabled: refuse cleanly
    // and create NO record, rather than a misleading FAILED row.
    if (!env.EXECUTION_ENABLED) {
      throw new ApiError(503, "EXECUTION_DISABLED", "Code execution is not enabled on this deployment");
    }
    const entryFile = await this.repos.files.findById(input.entryFileId);
    if (!entryFile || entryFile.projectId !== projectId || entryFile.type !== "FILE") {
      throw notFound("Entry file not found in this project.");
    }
    const language = languageForFile(entryFile);
    if (!language) {
      throw new ApiError(
        400,
        "UNSUPPORTED_LANGUAGE",
        `Files ending in "${path.extname(entryFile.name) || "(no extension)"}" cannot be executed. ` +
          "Supported entry points: .js, .mjs, .cjs, .py, .cpp, .cc, .cxx.",
      );
    }

    const files = await this.resolveFiles(projectId, input, entryFile);

    if (countInflightForUser(userId) >= env.EXECUTION_USER_INFLIGHT_MAX) {
      throw new ApiError(
        429,
        "TOO_MANY_RUNNING",
        `You already have ${env.EXECUTION_USER_INFLIGHT_MAX} executions running. Wait for one to finish or cancel it.`,
      );
    }

    let record = await this.repos.executions.create({ projectId, userId, language });
    onCreated?.(record.id);
    record = await this.repos.executions.update(record.id, { status: "RUNNING" });

    const controller = new AbortController();
    registerInflight(record.id, { userId, controller, cancelled: false });
    try {
      const result = await runOnExecutionService(
        {
          executionId: record.id,
          language,
          files,
          entryPoint: entryFile.path,
        },
        controller.signal,
      );
      // A cancel may have landed while the service was finishing: the
      // CANCELLED state written by cancel() wins over the service result.
      const current = await this.repos.executions.findById(record.id);
      if (current?.status === "CANCELLED") return toExecutionDto(current);
      const updated = await this.repos.executions.update(record.id, {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.durationMs,
      });
      return toExecutionDto(updated);
    } catch (e) {
      const entry = getInflight(record.id);
      if (entry?.cancelled || controller.signal.aborted) {
        const current = await this.repos.executions.findById(record.id);
        if (current?.status === "CANCELLED") return toExecutionDto(current);
        const updated = await this.repos.executions.update(record.id, { status: "CANCELLED" });
        return toExecutionDto(updated);
      }
      // Service unreachable / rejected: record an honest failure, never a
      // fabricated success.
      const message = e instanceof Error ? e.message : String(e);
      const updated = await this.repos.executions.update(record.id, {
        status: "FAILED",
        stderr: `Execution service unavailable: ${message}`,
        exitCode: null,
      });
      return toExecutionDto(updated);
    } finally {
      clearInflight(record.id);
    }
  }

  /** Resolves the file set (paths + contents) for a run, entirely server-side. */
  private async resolveFiles(
    projectId: string,
    input: CreateExecutionInput,
    entryFile: FileRecord,
  ): Promise<{ path: string; content: string }[]> {
    const byId = new Map<string, { file: FileRecord; content?: string }>();
    if (input.files && input.files.length > 0) {
      for (const item of input.files) {
        const file = await this.repos.files.findById(item.fileId);
        if (!file || file.projectId !== projectId || file.type !== "FILE") {
          throw notFound("One of the submitted files was not found in this project.");
        }
        byId.set(file.id, { file, content: item.content });
      }
    } else {
      const all = await this.repos.files.listByProject(projectId);
      for (const file of all) {
        if (file.type === "FILE") byId.set(file.id, { file });
      }
    }
    // The entry file is always part of the run, even if the client omitted it.
    if (!byId.has(entryFile.id)) byId.set(entryFile.id, { file: entryFile });
    if (byId.size > MAX_PROJECT_FILES) {
      throw badRequest(`Executions are limited to ${MAX_PROJECT_FILES} files per run.`);
    }
    const resolved: { path: string; content: string }[] = [];
    for (const { file, content } of byId.values()) {
      if (content !== undefined) {
        resolved.push({ path: file.path, content });
      } else {
        const latest = await this.repos.versions.latestForFile(file.id);
        resolved.push({ path: file.path, content: latest?.content ?? "" });
      }
    }
    return resolved;
  }

  /** Only the execution's creator may read it; everyone else gets 404. */
  async get(userId: string, executionId: string): Promise<ExecutionDto> {
    const record = await this.repos.executions.findById(executionId);
    if (!record || record.userId !== userId) throw notFound("Execution not found.");
    return toExecutionDto(record);
  }

  /**
   * Cancels a QUEUED/RUNNING execution owned by the caller: marks it
   * CANCELLED first (so a concurrently finishing run cannot overwrite it),
   * then aborts the service request and notifies the service.
   */
  async cancel(userId: string, executionId: string): Promise<ExecutionDto> {
    const record = await this.repos.executions.findById(executionId);
    if (!record || record.userId !== userId) throw notFound("Execution not found.");
    if (record.status !== "QUEUED" && record.status !== "RUNNING") {
      throw new ApiError(409, "EXECUTION_NOT_RUNNING", `Execution is already ${record.status.toLowerCase()} and cannot be cancelled.`);
    }
    const updated = await this.repos.executions.update(executionId, { status: "CANCELLED" });
    const entry = getInflight(executionId);
    if (entry) {
      entry.cancelled = true;
      entry.controller.abort();
    }
    void cancelOnExecutionService(executionId);
    return toExecutionDto(updated);
  }
}
