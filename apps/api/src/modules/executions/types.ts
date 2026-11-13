import type { ExecutionRecord } from "../../repositories/types.js";

export interface ExecutionDto {
  id: string;
  projectId: string;
  userId: string;
  language: string;
  status: ExecutionRecord["status"];
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  executionTimeMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export function toExecutionDto(record: ExecutionRecord): ExecutionDto {
  return {
    id: record.id,
    projectId: record.projectId,
    userId: record.userId,
    language: record.language,
    status: record.status,
    stdout: record.stdout,
    stderr: record.stderr,
    exitCode: record.exitCode,
    executionTimeMs: record.executionTime,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Shape returned by the internal execution service (apps/execution). */
export interface ExecutionServiceResult {
  executionId: string;
  status: "COMPLETED" | "FAILED" | "TIMEOUT";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  phase?: "compile" | "run";
  terminationReason?: string;
}
