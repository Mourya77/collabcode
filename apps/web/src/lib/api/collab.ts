import type { ProjectRole } from "@collabcode/shared";
import { api } from "./client";

export interface CollabTokenResponse {
  /** Short-lived (10 min) JWT, audience "collab", for the collaboration server. */
  token: string;
  user: { id: string; name: string; email: string };
  role: ProjectRole;
  expiresAt: string;
}

export const collabApi = {
  /** POST /api/collab/token — cookie auth + CSRF handled by the api client. */
  fetchToken: (projectId: string) => api.post<CollabTokenResponse>("/api/collab/token", { projectId }),
};
