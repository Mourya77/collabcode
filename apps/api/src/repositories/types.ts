import type { ProjectRole } from "@collabcode/shared";

/**
 * Repository layer. Services depend only on these interfaces.
 * Production uses the Prisma implementation (repositories/prisma.ts);
 * the test-suite can substitute an in-memory implementation when no database
 * is reachable (test/memoryRepos.ts) — that mode is always labelled in output.
 */

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberRecord {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: Date;
  updatedAt: Date;
}

export type FileTypeT = "FILE" | "FOLDER";

export interface FileRecord {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  type: FileTypeT;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Phase 6: how a DocumentVersion came to exist. */
export type VersionSource = "SAVE" | "SNAPSHOT" | "RESTORE" | "AUTOSAVE";

export interface VersionRecord {
  id: string;
  fileId: string;
  createdBy: string;
  content: string;
  source: VersionSource;
  label: string | null;
  createdAt: Date;
}

export type InvitationRole = "EDITOR" | "VIEWER";
export type InvitationStatusT = "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "EXPIRED";

export interface InvitationRecord {
  id: string;
  projectId: string;
  email: string;
  role: InvitationRole;
  invitedById: string;
  tokenHash: string;
  status: InvitationStatusT;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  projectId: string;
  senderId: string;
  content: string;
  createdAt: Date;
}

export interface MessageWithSender {
  message: MessageRecord;
  sender: UserRecord;
}

export interface UsersRepo {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Throws UniqueViolationError("email") on duplicate email. */
  create(data: { name: string; email: string; passwordHash: string }): Promise<UserRecord>;
  update(id: string, patch: { name?: string; avatarUrl?: string | null }): Promise<UserRecord>;
}

export interface TokensRepo {
  create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export interface ProjectsRepo {
  create(data: { name: string; description: string | null; ownerId: string }): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  update(id: string, patch: { name?: string; description?: string | null }): Promise<ProjectRecord>;
  remove(id: string): Promise<void>;
}

export interface MembersRepo {
  find(projectId: string, userId: string): Promise<MemberRecord | null>;
  list(projectId: string): Promise<MemberRecord[]>;
  /** Throws UniqueViolationError("membership") if already a member. */
  create(data: { projectId: string; userId: string; role: ProjectRole }): Promise<MemberRecord>;
  updateRole(projectId: string, userId: string, role: ProjectRole): Promise<MemberRecord>;
  remove(projectId: string, userId: string): Promise<void>;
  countOwners(projectId: string): Promise<number>;
  listForUser(userId: string): Promise<{ member: MemberRecord; project: ProjectRecord }[]>;
}

export interface FilesRepo {
  listByProject(projectId: string): Promise<FileRecord[]>;
  findById(id: string): Promise<FileRecord | null>;
  findByPath(projectId: string, path: string): Promise<FileRecord | null>;
  /** Throws UniqueViolationError("path") on (projectId, path) conflict. */
  create(data: { projectId: string; parentId: string | null; name: string; type: FileTypeT; path: string }): Promise<FileRecord>;
  update(id: string, patch: { name?: string; parentId?: string | null; path?: string }): Promise<FileRecord>;
  /** Deleting a folder cascades to children and their versions (DB FK / manual in memory impl). */
  remove(id: string): Promise<void>;
  /** Files whose path is strictly below folderPath. */
  listDescendants(projectId: string, folderPath: string): Promise<FileRecord[]>;
}

export interface VersionsRepo {
  create(data: {
    fileId: string;
    createdBy: string;
    content: string;
    source?: VersionSource;
    label?: string | null;
  }): Promise<VersionRecord>;
  listByFile(fileId: string): Promise<VersionRecord[]>;
  findById(id: string): Promise<VersionRecord | null>;
  latestForFile(fileId: string): Promise<VersionRecord | null>;
}

export interface InvitationsRepo {
  create(data: {
    projectId: string;
    email: string;
    role: InvitationRole;
    invitedById: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<InvitationRecord>;
  findById(id: string): Promise<InvitationRecord | null>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  /** Latest invitation for (project, email) in PENDING status, if any. */
  findPending(projectId: string, email: string): Promise<InvitationRecord | null>;
  listByProject(projectId: string): Promise<InvitationRecord[]>;
  /** All PENDING invitations addressed to an email, newest first. */
  listPendingForEmail(email: string): Promise<InvitationRecord[]>;
  updateStatus(id: string, status: InvitationStatusT): Promise<InvitationRecord>;
}

export type ExecutionStatusT = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLED";
export type ExecutionLanguageT = "javascript" | "python" | "cpp";

export interface ExecutionRecord {
  id: string;
  projectId: string;
  userId: string;
  language: string;
  status: ExecutionStatusT;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  /** Wall-clock duration of the run, ms (stored in the `executionTime` column). */
  executionTime: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionsRepo {
  create(data: { projectId: string; userId: string; language: string }): Promise<ExecutionRecord>;
  findById(id: string): Promise<ExecutionRecord | null>;
  update(
    id: string,
    patch: Partial<{ status: ExecutionStatusT; stdout: string | null; stderr: string | null; exitCode: number | null; executionTime: number | null }>,
  ): Promise<ExecutionRecord>;
  /** Executions of one user currently in QUEUED/RUNNING (in-flight cap). */
  countActiveForUser(userId: string): Promise<number>;
  /** Most recent executions of one user, newest first. */
  listForUser(userId: string, limit?: number): Promise<ExecutionRecord[]>;
}

export interface MessagesRepo {
  create(data: { projectId: string; senderId: string; content: string }): Promise<MessageWithSender>;
  findById(id: string): Promise<MessageRecord | null>;
  /**
   * One newest-first page of a project's messages. When `before` is given,
   * only messages strictly older than that message in the (createdAt, id)
   * descending order are returned. Returns at most `limit` rows.
   */
  listPage(projectId: string, opts: { limit: number; before?: MessageRecord }): Promise<MessageWithSender[]>;
}

export interface Repos {
  users: UsersRepo;
  tokens: TokensRepo;
  projects: ProjectsRepo;
  members: MembersRepo;
  files: FilesRepo;
  versions: VersionsRepo;
  invitations: InvitationsRepo;
  messages: MessagesRepo;
  executions: ExecutionsRepo;
  /** Runs fn atomically where the backing store supports transactions (Prisma $transaction). */
  withTransaction<T>(fn: (r: Repos) => Promise<T>): Promise<T>;
  /** Readiness probe (Phase 7): true when the backing store answers a trivial query. */
  ping(): Promise<boolean>;
}
