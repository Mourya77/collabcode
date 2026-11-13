import type { Repos } from "../../repositories/types.js";
import { notFound, unauthorized } from "../../utils/errors.js";
import { COLLAB_TOKEN_TTL_SECONDS, signCollabToken } from "../../utils/tokens.js";
import type { CollabTokenInput } from "./schemas.js";
import type { CollabTokenResponse } from "./types.js";

export class CollabService {
  constructor(private readonly repos: Repos) {}

  /**
   * Issues a collaboration token. Membership is required — non-members get
   * the same 404 as every other project resource (existence is not leaked).
   */
  async issueToken(userId: string, input: CollabTokenInput): Promise<CollabTokenResponse> {
    const member = await this.repos.members.find(input.projectId, userId);
    if (!member) throw notFound("Project not found.");
    const user = await this.repos.users.findById(userId);
    if (!user) throw unauthorized("Session expired or invalid. Please log in again.");
    const token = signCollabToken({ userId, projectId: input.projectId, role: member.role, name: user.name });
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
      role: member.role,
      expiresAt: new Date(Date.now() + COLLAB_TOKEN_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
