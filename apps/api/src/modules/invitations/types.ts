import type { InvitationRecord, InvitationRole, InvitationStatusT } from "../../repositories/types.js";

export interface InvitationDto {
  id: string;
  projectId: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatusT;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitationResult extends InvitationDto {
  /**
   * Development-mode invitation link containing the RAW token. Present only
   * because email delivery is not configured (DevMailer); production email
   * deployments should treat this field as internal — see docs/api.md.
   */
  inviteUrl: string;
  /** True when a CollabCode account already exists for the invited email. */
  invitedUserExists: boolean;
}

/** Public preview for GET /api/invitations/:token — deliberately minimal. */
export interface InvitationPreviewDto {
  projectName: string;
  inviterName: string;
  role: InvitationRole;
  status: InvitationStatusT;
  expiresAt: string;
}

/** One entry of GET /api/invitations/mine. */
export interface MyInvitationDto extends InvitationDto {
  projectName: string;
  inviterName: string;
}

export function toInvitationDto(i: InvitationRecord): InvitationDto {
  return {
    id: i.id,
    projectId: i.projectId,
    email: i.email,
    role: i.role,
    status: i.status,
    invitedById: i.invitedById,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}
