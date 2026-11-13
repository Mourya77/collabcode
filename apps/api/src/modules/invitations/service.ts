import { env } from "../../config/env.js";
import { getMailer } from "../../lib/mailer.js";
import type { InvitationRecord, ProjectRecord, Repos } from "../../repositories/types.js";
import { ApiError, UniqueViolationError, badRequest, conflict, notFound } from "../../utils/errors.js";
import { generateInvitationToken, hashToken } from "../../utils/tokens.js";
import { toProjectDto, type ProjectDto } from "../projects/types.js";
import type { CreateInvitationInput } from "./schemas.js";
import { toInvitationDto, type CreateInvitationResult, type InvitationPreviewDto, type MyInvitationDto } from "./types.js";

/**
 * Invitations v2 (Phase 4): a true invite flow replacing Phase 2's direct-add.
 *
 * Creating an invitation does NOT create a membership — the invitee becomes a
 * member only by accepting while signed in with the invited email address
 * (tokens are bound to the email, never transferable). Only the SHA-256 hash
 * of the token is stored; the raw token exists solely in the emailed /
 * returned invite link. PENDING invitations past their expiry are lazily
 * transitioned to EXPIRED wherever they are touched.
 */
export class InvitationsService {
  constructor(private readonly repos: Repos) {}

  /** Persists-and-returns the invitation's effective status (lazy expiry). */
  private async effective(inv: InvitationRecord): Promise<InvitationRecord> {
    if (inv.status === "PENDING" && inv.expiresAt.getTime() <= Date.now()) {
      return this.repos.invitations.updateStatus(inv.id, "EXPIRED");
    }
    return inv;
  }

  inviteUrlFor(rawToken: string): string {
    return `${env.APP_BASE_URL.replace(/\/$/, "")}/invite/${rawToken}`;
  }

  async create(callerId: string, project: ProjectRecord, input: CreateInvitationInput): Promise<CreateInvitationResult> {
    const caller = await this.repos.users.findById(callerId);
    if (!caller) throw notFound("User not found.");
    if (input.email === caller.email) {
      throw badRequest("You cannot invite yourself — you already own this project.");
    }
    const invitedUser = await this.repos.users.findByEmail(input.email);
    if (invitedUser) {
      const member = await this.repos.members.find(project.id, invitedUser.id);
      if (member) throw conflict("That user is already a member of this project.");
    }
    const pending = await this.repos.invitations.findPending(project.id, input.email);
    if (pending) {
      const effective = await this.effective(pending);
      if (effective.status === "PENDING") {
        throw new ApiError(409, "DUPLICATE_INVITATION", "A pending invitation for that email already exists for this project.");
      }
    }
    const { raw, hash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + env.INVITATION_TTL_DAYS * 86_400_000);
    let inv: InvitationRecord;
    try {
      inv = await this.repos.invitations.create({
        projectId: project.id,
        email: input.email,
        role: input.role,
        invitedById: callerId,
        tokenHash: hash,
        expiresAt,
      });
    } catch (e) {
      if (e instanceof UniqueViolationError) throw conflict("Could not create the invitation. Please try again.");
      throw e;
    }
    const inviteUrl = this.inviteUrlFor(raw);
    await getMailer().sendInvitation({
      to: input.email,
      inviteUrl,
      projectName: project.name,
      inviterName: caller.name,
      role: input.role,
      expiresAt,
    });
    return { ...toInvitationDto(inv), inviteUrl, invitedUserExists: invitedUser !== null };
  }

  async listForProject(project: ProjectRecord, status?: string): Promise<ReturnType<typeof toInvitationDto>[]> {
    const all = await this.repos.invitations.listByProject(project.id);
    const out: InvitationRecord[] = [];
    for (const inv of all) {
      const effective = await this.effective(inv);
      if (!status || effective.status === status) out.push(effective);
    }
    return out.map(toInvitationDto);
  }

  async revoke(project: ProjectRecord, invitationId: string): Promise<ReturnType<typeof toInvitationDto>> {
    const inv = await this.repos.invitations.findById(invitationId);
    if (!inv || inv.projectId !== project.id) throw notFound("Invitation not found.");
    const effective = await this.effective(inv);
    if (effective.status !== "PENDING") {
      throw conflict(`Only a pending invitation can be revoked (this one is ${effective.status.toLowerCase()}).`);
    }
    return toInvitationDto(await this.repos.invitations.updateStatus(inv.id, "REVOKED"));
  }

  private async findByRawToken(rawToken: string): Promise<InvitationRecord> {
    if (!rawToken || rawToken.length > 200) throw notFound("Invitation not found.");
    const inv = await this.repos.invitations.findByTokenHash(hashToken(rawToken));
    if (!inv) throw notFound("Invitation not found.");
    return inv;
  }

  /** Public preview — project + inviter names and the invite's state only. */
  async preview(rawToken: string): Promise<InvitationPreviewDto> {
    const inv = await this.effective(await this.findByRawToken(rawToken));
    const project = await this.repos.projects.findById(inv.projectId);
    const inviter = await this.repos.users.findById(inv.invitedById);
    if (!project) throw notFound("Invitation not found.");
    return {
      projectName: project.name,
      inviterName: inviter?.name ?? "A CollabCode user",
      role: inv.role,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  async listMine(userId: string): Promise<MyInvitationDto[]> {
    const caller = await this.repos.users.findById(userId);
    if (!caller) throw notFound("User not found.");
    const pending = await this.repos.invitations.listPendingForEmail(caller.email);
    const out: MyInvitationDto[] = [];
    for (const inv of pending) {
      const effective = await this.effective(inv);
      if (effective.status !== "PENDING") continue; // just expired — hidden from "mine"
      const project = await this.repos.projects.findById(inv.projectId);
      if (!project) continue;
      const inviter = await this.repos.users.findById(inv.invitedById);
      out.push({
        ...toInvitationDto(effective),
        projectName: project.name,
        inviterName: inviter?.name ?? "A CollabCode user",
      });
    }
    return out;
  }

  /**
   * Shared gate for accept/decline: applies lazy expiry, enforces status and
   * the email-binding rule. Used by both the token flow (invite link) and
   * the by-id flow (dashboard "Invitations for you" — the raw token is never
   * stored, so a signed-in invitee cannot rebuild the link from /mine).
   */
  private async gate(callerEmail: string, record: InvitationRecord): Promise<InvitationRecord> {
    const inv = await this.effective(record);
    if (inv.status === "EXPIRED") {
      throw new ApiError(410, "INVITATION_EXPIRED", "This invitation has expired. Ask the project owner to send a new one.");
    }
    if (inv.status !== "PENDING") {
      throw conflict(`This invitation has already been ${inv.status.toLowerCase()}.`);
    }
    if (callerEmail !== inv.email) {
      throw new ApiError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "This invitation was sent to a different email address. Sign in with the invited email to respond to it.",
      );
    }
    return inv;
  }

  private async actionableFor(userId: string, rawToken: string): Promise<InvitationRecord> {
    const caller = await this.repos.users.findById(userId);
    if (!caller) throw notFound("User not found.");
    return this.gate(caller.email, await this.findByRawToken(rawToken));
  }

  private async actionableById(userId: string, invitationId: string): Promise<InvitationRecord> {
    const caller = await this.repos.users.findById(userId);
    if (!caller) throw notFound("User not found.");
    const record = await this.repos.invitations.findById(invitationId);
    if (!record) throw notFound("Invitation not found.");
    return this.gate(caller.email, record);
  }

  private async doAccept(userId: string, inv: InvitationRecord): Promise<ProjectDto> {
    const existing = await this.repos.members.find(inv.projectId, userId);
    if (existing) throw conflict("You are already a member of this project.");
    const project = await this.repos.projects.findById(inv.projectId);
    if (!project) throw notFound("Project not found.");
    await this.repos.withTransaction(async (r) => {
      try {
        await r.members.create({ projectId: inv.projectId, userId, role: inv.role });
      } catch (e) {
        if (e instanceof UniqueViolationError) throw conflict("You are already a member of this project.");
        throw e;
      }
      await r.invitations.updateStatus(inv.id, "ACCEPTED");
    });
    const files = await this.repos.files.listByProject(project.id);
    return toProjectDto(project, inv.role, files.filter((f) => f.type === "FILE").length);
  }

  private async doDecline(inv: InvitationRecord): Promise<ReturnType<typeof toInvitationDto>> {
    return toInvitationDto(await this.repos.invitations.updateStatus(inv.id, "DECLINED"));
  }

  async accept(userId: string, rawToken: string): Promise<ProjectDto> {
    return this.doAccept(userId, await this.actionableFor(userId, rawToken));
  }

  async decline(userId: string, rawToken: string): Promise<ReturnType<typeof toInvitationDto>> {
    return this.doDecline(await this.actionableFor(userId, rawToken));
  }

  /** Dashboard flow: same rules as the token flow, keyed by invitation id. */
  async acceptById(userId: string, invitationId: string): Promise<ProjectDto> {
    return this.doAccept(userId, await this.actionableById(userId, invitationId));
  }

  async declineById(userId: string, invitationId: string): Promise<ReturnType<typeof toInvitationDto>> {
    return this.doDecline(await this.actionableById(userId, invitationId));
  }
}
