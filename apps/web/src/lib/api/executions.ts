import { apiRequest } from "./client";
import type { ApiExecution, ExecutionFileInput } from "./types";

/**
 * Code execution endpoints (Phase 5). Creating an execution BLOCKS until
 * the run finishes (the API waits on the isolated execution service), so
 * callers pass an AbortSignal: aborting the request cancels the run
 * server-side (the API marks it CANCELLED and kills it in the service).
 */
export const executionsApi = {
  create: (projectId: string, entryFileId: string, files: ExecutionFileInput[], signal?: AbortSignal) =>
    apiRequest<ApiExecution>(`/api/projects/${projectId}/executions`, {
      method: "POST",
      body: { entryFileId, files },
      signal,
      retryAuth: false,
    }),
  get: (executionId: string) => apiRequest<ApiExecution>(`/api/executions/${executionId}`),
  cancel: (executionId: string) => apiRequest<ApiExecution>(`/api/executions/${executionId}/cancel`, { method: "POST" }),
};
