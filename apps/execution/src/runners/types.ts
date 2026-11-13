import type { LanguageId, StepPhase } from "../languages.js";

export interface JobFile {
  path: string;
  content: string;
}

export interface ExecuteJob {
  executionId: string;
  language: LanguageId;
  files: JobFile[];
  /** Path of the entry file; must be one of `files[].path`. */
  entryPoint: string;
  stdin?: string;
  /** Wall-clock budget for the WHOLE job (compile + run), ms. */
  timeoutMs: number;
}

export type RunStatus = "COMPLETED" | "FAILED" | "TIMEOUT";

/** Why a job was terminated early, when it was. */
export type TerminationReason = "timeout" | "cancel" | "memory" | "client-disconnect";

export interface RunResult {
  status: RunStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  /** Set when the failing/terminating step was the compile step. */
  phase?: StepPhase;
  terminationReason?: TerminationReason;
}

export interface RunnerHooks {
  /**
   * The runner calls this once the job's processes exist so the service can
   * terminate the job early (cancel endpoint / client disconnect). The
   * `reason` distinguishes a user cancel from a dropped connection.
   */
  registerKill: (kill: (reason: TerminationReason) => void) => void;
}

export interface Runner {
  readonly kind: "docker" | "subprocess";
  run(job: ExecuteJob, hooks: RunnerHooks): Promise<RunResult>;
}

/** Accumulates process output with a hard byte cap (UTF-8 safe truncation). */
export class OutputCollector {
  private chunks: Buffer[] = [];
  private bytes = 0;
  truncated = false;

  constructor(private readonly capBytes: number) {}

  append(data: Buffer | string): void {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (this.bytes >= this.capBytes) {
      if (buf.length > 0) this.truncated = true;
      return;
    }
    const room = this.capBytes - this.bytes;
    if (buf.length > room) {
      this.chunks.push(buf.subarray(0, room));
      this.bytes += room;
      this.truncated = true;
    } else {
      this.chunks.push(buf);
      this.bytes += buf.length;
    }
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString("utf8");
    return this.truncated ? `${text}\n…[output truncated]` : text;
  }
}
