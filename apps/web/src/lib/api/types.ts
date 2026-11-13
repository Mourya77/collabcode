import type { ProjectRole } from "@collabcode/shared";

export type { ProjectRole };

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiProject {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role: ProjectRole;
  fileCount: number;
}

export interface ProjectList {
  items: ApiProject[];
  total: number;
  page: number;
  limit: number;
}

export interface ApiFile {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  type: "FILE" | "FOLDER";
  path: string;
  createdAt: string;
  updatedAt: string;
  content?: string | null;
}

export interface ApiMember {
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  user: { name: string; email: string; avatarUrl: string | null };
}

export type ApiVersionSource = "SAVE" | "SNAPSHOT" | "RESTORE" | "AUTOSAVE";

export interface ApiVersionMeta {
  id: string;
  fileId: string;
  createdBy: string;
  createdAt: string;
  /** Phase 6: how this version came to exist. */
  source: ApiVersionSource;
  label: string | null;
  author: { id: string; name: string };
  /** Content length in characters; content itself only comes from getVersion. */
  sizeBytes: number;
}

export interface ApiRestoreResult {
  restoredVersionId: string;
  snapshotVersionId: string;
}

// ---- Phase 4: invitations, chat, workspace presence ----

export type InvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "EXPIRED";
export type InvitableRole = Exclude<ProjectRole, "OWNER">;

export interface ApiInvitation {
  id: string;
  projectId: string;
  email: string;
  role: InvitableRole;
  status: InvitationStatus;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Create response: the invitation plus the development-mode invite link. */
export interface ApiInvitationCreated extends ApiInvitation {
  inviteUrl: string;
  invitedUserExists: boolean;
}

/** Public preview (GET /api/invitations/:token) — deliberately minimal. */
export interface ApiInvitationPreview {
  projectName: string;
  inviterName: string;
  role: InvitableRole;
  status: InvitationStatus;
  expiresAt: string;
}

/** One entry of GET /api/invitations/mine (invitation + display names). */
export interface ApiMyInvitation extends ApiInvitation {
  projectName: string;
  inviterName: string;
}

export interface ApiChatSender {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ApiChatMessage {
  id: string;
  projectId: string;
  content: string;
  createdAt: string;
  sender: ApiChatSender;
}

export interface ApiMessagePage {
  messages: ApiChatMessage[];
  nextCursor: string | null;
}

export interface ApiPresenceUser {
  userId: string;
  name: string;
  activeFileId: string | null;
  lastSeenAt: string;
}

export interface ApiPresenceMember extends ApiPresenceUser {
  email: string;
  avatarUrl: string | null;
  role: ProjectRole;
  online: boolean;
}

export interface ApiPresence {
  online: ApiPresenceUser[];
  members: ApiPresenceMember[];
}

export type ExecutionStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLED";

export interface ApiExecution {
  id: string;
  projectId: string;
  userId: string;
  language: string;
  status: ExecutionStatus;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  executionTimeMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionFileInput {
  fileId: string;
  /** Live editor content; omit to run the latest saved version. */
  content?: string;
}
