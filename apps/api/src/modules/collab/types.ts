import type { ProjectRole } from "@collabcode/shared";

/** Response body of POST /api/collab/token. */
export interface CollabTokenResponse {
  /** Short-lived (10 min) JWT, audience "collab", for the collaboration server. */
  token: string;
  user: { id: string; name: string; email: string };
  role: ProjectRole;
  /** ISO timestamp when the token expires; the client re-fetches on reconnect. */
  expiresAt: string;
}
