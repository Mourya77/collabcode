import type { TerminationReason } from "./runners/types.js";

/**
 * In-flight job registry: enforces the concurrency cap and routes cancel /
 * client-disconnect kills to the runner currently executing a job.
 * Single-process by design (the execution service is one process per host;
 * scale by adding hosts behind the API, not by sharing this map).
 */
export class JobRegistry {
  private readonly jobs = new Map<string, { kill: ((reason: TerminationReason) => void) | null }>();
  private readonly pendingCancels = new Set<string>();

  constructor(private readonly maxConcurrent: number) {}

  get activeCount(): number {
    return this.jobs.size;
  }

  /** Reserves a slot. Returns false when the concurrency cap is reached. */
  tryAcquire(executionId: string): boolean {
    if (this.jobs.has(executionId)) return true;
    if (this.jobs.size >= this.maxConcurrent) return false;
    this.jobs.set(executionId, { kill: null });
    return true;
  }

  /** Called by the runner once its processes exist. */
  registerKill(executionId: string, kill: (reason: TerminationReason) => void): void {
    const entry = this.jobs.get(executionId);
    if (entry) entry.kill = kill;
    // A cancel that arrived before the runner was ready still applies.
    if (this.pendingCancels.has(executionId)) {
      this.pendingCancels.delete(executionId);
      kill("cancel");
    }
  }

  /** Kills a running job. Returns false when no such job is in flight. */
  kill(executionId: string, reason: TerminationReason): boolean {
    const entry = this.jobs.get(executionId);
    if (!entry) return false;
    if (entry.kill) entry.kill(reason);
    else this.pendingCancels.add(executionId);
    return true;
  }

  release(executionId: string): void {
    this.jobs.delete(executionId);
    this.pendingCancels.delete(executionId);
  }
}
