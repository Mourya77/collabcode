/**
 * In-flight execution registry for THIS API process: maps an execution id to
 * the AbortController of its outstanding execution-service request, so the
 * cancel endpoint can terminate the run (aborting the fetch also makes the
 * execution service kill the job via its client-disconnect handler).
 *
 * In-memory / single-process by design — the same documented limitation as
 * chat presence (Phase 4); a multi-instance API would need a shared
 * registry (Phase 6 hardening).
 */
export interface InflightEntry {
  userId: string;
  controller: AbortController;
  /** Set by the cancel endpoint before aborting, so create() knows the
   *  resulting fetch failure is a cancellation, not a service outage. */
  cancelled: boolean;
}

const inflight = new Map<string, InflightEntry>();

export function registerInflight(executionId: string, entry: InflightEntry): void {
  inflight.set(executionId, entry);
}

export function getInflight(executionId: string): InflightEntry | undefined {
  return inflight.get(executionId);
}

export function clearInflight(executionId: string): void {
  inflight.delete(executionId);
}

export function countInflightForUser(userId: string): number {
  let n = 0;
  for (const entry of inflight.values()) if (entry.userId === userId) n += 1;
  return n;
}
