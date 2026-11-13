import { forbidden, notFound } from "../../utils/errors.js";
import type { Repos } from "../../repositories/types.js";
import type { UpdateMemberInput } from "./schemas.js";
import type { MemberDto } from "./types.js";

export class MembersService {
  constructor(private readonly repos: Repos) {}

  async list(projectId: string): Promise<MemberDto[]> {
    const members = await this.repos.members.list(projectId);
    const out: MemberDto[] = [];
    for (const m of members) {
      const user = await this.repos.users.findById(m.userId);
      if (!user) continue;
      out.push({ userId: m.userId, role: m.role, joinedAt: m.createdAt.toISOString(), user: { name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
    }
    return out;
  }

  /**
   * OWNER-only (enforced by route middleware). A member can never change their
   * own role (no self-escalation, no self-demotion games), and the last OWNER
   * cannot be demoted.
   */
  async updateRole(projectId: string, callerId: string, targetUserId: string, input: UpdateMemberInput): Promise<MemberDto> {
    if (targetUserId === callerId) throw forbidden("You cannot change your own role.");
    const target = await this.repos.members.find(projectId, targetUserId);
    if (!target) throw notFound("Member not found.");
    if (target.role === "OWNER" && input.role !== "OWNER") {
      const owners = await this.repos.members.countOwners(projectId);
      if (owners <= 1) throw forbidden("Cannot demote the last owner of the project.");
    }
    const updated = await this.repos.members.updateRole(projectId, targetUserId, input.role);
    const user = await this.repos.users.findById(targetUserId);
    if (!user) throw notFound("Member not found.");
    return { userId: user.id, role: updated.role, joinedAt: updated.createdAt.toISOString(), user: { name: user.name, email: user.email, avatarUrl: user.avatarUrl } };
  }

  /** OWNER removing someone else, or any member leaving. The last OWNER cannot leave. */
  async remove(projectId: string, callerId: string, callerRole: string, targetUserId: string): Promise<void> {
    const isSelf = targetUserId === callerId;
    if (!isSelf && callerRole !== "OWNER") throw forbidden("Only the project owner can remove other members.");
    const target = await this.repos.members.find(projectId, targetUserId);
    if (!target) throw notFound("Member not found.");
    if (target.role === "OWNER") {
      const owners = await this.repos.members.countOwners(projectId);
      if (owners <= 1) throw forbidden("The last owner cannot leave the project. Transfer ownership or delete the project instead.");
    }
    await this.repos.members.remove(projectId, targetUserId);
  }
}
