import { api } from "./client";
import type { ApiMessagePage, ApiPresence } from "./types";

/**
 * Chat REST surface (Phase 4): history + workspace presence. Sending happens
 * over the WebSocket gateway — see lib/chat/chatClient.ts.
 */
export const chatApi = {
  listMessages: (projectId: string, params: { cursor?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api.get<ApiMessagePage>(`/api/projects/${projectId}/messages${suffix}`);
  },
  presence: (projectId: string) => api.get<ApiPresence>(`/api/projects/${projectId}/presence`),
};
