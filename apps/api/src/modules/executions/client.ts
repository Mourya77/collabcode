import { env } from "../../config/env.js";
import type { ExecutionServiceResult } from "./types.js";

/**
 * The ONLY client of the internal execution service. The public API calls
 * it with the shared internal token; browsers never talk to the execution
 * service directly (it is not publicly exposed).
 */

export interface ExecutionServiceRequest {
  executionId: string;
  language: string;
  files: { path: string; content: string }[];
  entryPoint: string;
}

function baseUrl(): string {
  // Callers (ExecutionsService.create) refuse with 503 EXECUTION_DISABLED
  // before reaching this client when no service is configured; this guard
  // is defence in depth so a null URL can never become a bogus fetch.
  if (!env.EXECUTION_SERVICE_URL) throw new Error("Code execution is not enabled on this deployment");
  return env.EXECUTION_SERVICE_URL.replace(/\/$/, "");
}

export async function runOnExecutionService(
  payload: ExecutionServiceRequest,
  signal: AbortSignal,
): Promise<ExecutionServiceResult> {
  const res = await fetch(`${baseUrl()}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": env.EXECUTION_INTERNAL_TOKEN },
    body: JSON.stringify(payload),
    signal,
  });
  const body = (await res.json().catch(() => null)) as ExecutionServiceResult | { error?: { message?: string } } | null;
  if (!res.ok || !body || !("status" in body)) {
    const message =
      body && "error" in body && body.error?.message ? body.error.message : `Execution service responded ${res.status}.`;
    throw new Error(message);
  }
  return body;
}

/** Best-effort cancel notification; the AbortController is the primary kill. */
export async function cancelOnExecutionService(executionId: string): Promise<void> {
  if (!env.EXECUTION_SERVICE_URL) return; // execution disabled: nothing to notify
  try {
    await fetch(`${baseUrl()}/execute/${executionId}/cancel`, {
      method: "POST",
      headers: { "x-internal-token": env.EXECUTION_INTERNAL_TOKEN },
    });
  } catch {
    // The service may already have finished/released the job — the API-side
    // state transition to CANCELLED does not depend on this call.
  }
}
