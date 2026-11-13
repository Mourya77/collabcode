import { create } from "zustand";
import { ApiClientError } from "../lib/api/client";
import { executionsApi } from "../lib/api/executions";
import type { ApiExecution, ExecutionFileInput } from "../lib/api/types";

/**
 * Phase 5 — code execution state for the workspace Output panel.
 *
 * A run is one blocking API call: the API waits for the isolated execution
 * service and returns the finished execution. Cancelling aborts that
 * request, which the API treats as a cancellation (the run is killed in
 * the execution service and the record is marked CANCELLED).
 */
/**
 * "disabled" (Phase 8): the deployment has no execution service configured
 * (EXECUTION_SERVICE_URL unset in production) — the API answered
 * 503 EXECUTION_DISABLED. A calm notice, not an error.
 */
export type ExecutionPhase = "idle" | "running" | "done" | "error" | "disabled";

interface ExecutionState {
  phase: ExecutionPhase;
  execution: ApiExecution | null;
  error: string | null;
  /** True when the last run ended because the user pressed Cancel. */
  cancelledByUser: boolean;
  entryFileName: string | null;
  startedAt: number | null;
  run: (args: { projectId: string; entryFileId: string; entryFileName: string; files: ExecutionFileInput[] }) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

let activeController: AbortController | null = null;

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  phase: "idle",
  execution: null,
  error: null,
  cancelledByUser: false,
  entryFileName: null,
  startedAt: null,

  async run({ projectId, entryFileId, entryFileName, files }) {
    if (get().phase === "running") return;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    set({ phase: "running", execution: null, error: null, cancelledByUser: false, entryFileName, startedAt: Date.now() });
    try {
      const dto = await executionsApi.create(projectId, entryFileId, files, controller.signal);
      if (activeController === controller) {
        set({ phase: "done", execution: dto, startedAt: null });
      }
    } catch (e) {
      if (activeController !== controller) return;
      if (e instanceof DOMException && e.name === "AbortError") {
        // Our own Cancel: the server marked the run CANCELLED; the DTO is
        // not delivered (the connection is gone), so present it locally.
        set({ phase: "done", execution: null, cancelledByUser: true, startedAt: null });
      } else if (e instanceof ApiClientError && e.code === "EXECUTION_DISABLED") {
        set({ phase: "disabled", error: e.message, startedAt: null });
      } else if (e instanceof ApiClientError) {
        set({ phase: "error", error: e.message, startedAt: null });
      } else {
        set({ phase: "error", error: "The run failed unexpectedly. Please try again.", startedAt: null });
      }
    } finally {
      if (activeController === controller) activeController = null;
    }
  },

  cancel() {
    if (get().phase !== "running") return;
    set({ cancelledByUser: true });
    activeController?.abort();
  },

  clear() {
    activeController?.abort();
    activeController = null;
    set({ phase: "idle", execution: null, error: null, cancelledByUser: false, entryFileName: null, startedAt: null });
  },
}));
