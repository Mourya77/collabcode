import { randomUUID } from "node:crypto";
import type {
  ExecutionRecord, FileRecord, InvitationRecord, MemberRecord, MessageRecord, ProjectRecord, RefreshTokenRecord, Repos, UserRecord, VersionRecord,
} from "../src/repositories/types.js";
import { UniqueViolationError } from "../src/utils/errors.js";

/**
 * In-memory Repos implementation — TEST FALLBACK ONLY.
 *
 * Used by the integration suite only when no PostgreSQL is reachable
 * (see test/global-setup.ts). It honours the same contracts as the Prisma
 * implementation (unique constraints, cascades, ordering) so service logic is
 * exercised identically; it proves nothing about SQL or migrations.
 */
export interface MemoryRepos extends Repos {
  reset(): void;
}

export function createMemoryRepos(): MemoryRepos {
  let users = new Map<string, UserRecord>();
  let tokens = new Map<string, RefreshTokenRecord>();
  let projects = new Map<string, ProjectRecord>();
  let members = new Map<string, MemberRecord>();
  let files = new Map<string, FileRecord>();
  let versions = new Map<string, VersionRecord>();
  let invitations = new Map<string, InvitationRecord>();
  let messages = new Map<string, MessageRecord>();
  let executions = new Map<string, ExecutionRecord>();

  const now = () => new Date();
  const memberKey = (p: string, u: string) => `${p}:${u}`;

  function deleteFileCascade(fileId: string): void {
    for (const f of [...files.values()].filter((x) => x.parentId === fileId)) deleteFileCascade(f.id);
    for (const v of [...versions.values()].filter((x) => x.fileId === fileId)) versions.delete(v.id);
    files.delete(fileId);
  }

  const repos: MemoryRepos = {
    users: {
      async findByEmail(email) {
        return [...users.values()].find((u) => u.email === email) ?? null;
      },
      async findById(id) {
        return users.get(id) ?? null;
      },
      async create(data) {
        if ([...users.values()].some((u) => u.email === data.email)) throw new UniqueViolationError("email");
        const user: UserRecord = { id: randomUUID(), avatarUrl: null, createdAt: now(), updatedAt: now(), ...data };
        users.set(user.id, user);
        return user;
      },
      async update(id, patch) {
        const user = users.get(id);
        if (!user) throw new Error("user not found");
        const updated = { ...user, ...patch, updatedAt: now() };
        users.set(id, updated);
        return updated;
      },
    },
    tokens: {
      async create(data) {
        const row: RefreshTokenRecord = { id: randomUUID(), revokedAt: null, createdAt: now(), ...data };
        tokens.set(row.id, row);
        return row;
      },
      async findByHash(tokenHash) {
        return [...tokens.values()].find((t) => t.tokenHash === tokenHash) ?? null;
      },
      async revoke(id) {
        const row = tokens.get(id);
        if (row) tokens.set(id, { ...row, revokedAt: now() });
      },
      async revokeAllForUser(userId) {
        for (const t of tokens.values()) {
          if (t.userId === userId && !t.revokedAt) tokens.set(t.id, { ...t, revokedAt: now() });
        }
      },
    },
    projects: {
      async create(data) {
        const project: ProjectRecord = { id: randomUUID(), createdAt: now(), updatedAt: now(), ...data };
        projects.set(project.id, project);
        return project;
      },
      async findById(id) {
        return projects.get(id) ?? null;
      },
      async update(id, patch) {
        const project = projects.get(id);
        if (!project) throw new Error("project not found");
        const updated = { ...project, ...patch, updatedAt: now() };
        projects.set(id, updated);
        return updated;
      },
      async remove(id) {
        projects.delete(id);
        for (const m of [...members.values()].filter((x) => x.projectId === id)) members.delete(memberKey(m.projectId, m.userId));
        for (const f of [...files.values()].filter((x) => x.projectId === id && x.parentId === null)) deleteFileCascade(f.id);
        for (const i of [...invitations.values()].filter((x) => x.projectId === id)) invitations.delete(i.id);
        for (const m of [...messages.values()].filter((x) => x.projectId === id)) messages.delete(m.id);
        for (const e of [...executions.values()].filter((x) => x.projectId === id)) executions.delete(e.id);
      },
    },
    members: {
      async find(projectId, userId) {
        return members.get(memberKey(projectId, userId)) ?? null;
      },
      async list(projectId) {
        return [...members.values()].filter((m) => m.projectId === projectId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },
      async create(data) {
        if (members.has(memberKey(data.projectId, data.userId))) throw new UniqueViolationError("membership");
        const member: MemberRecord = { id: randomUUID(), createdAt: now(), updatedAt: now(), ...data };
        members.set(memberKey(data.projectId, data.userId), member);
        return member;
      },
      async updateRole(projectId, userId, role) {
        const member = members.get(memberKey(projectId, userId));
        if (!member) throw new Error("member not found");
        const updated = { ...member, role, updatedAt: now() };
        members.set(memberKey(projectId, userId), updated);
        return updated;
      },
      async remove(projectId, userId) {
        members.delete(memberKey(projectId, userId));
      },
      async countOwners(projectId) {
        return [...members.values()].filter((m) => m.projectId === projectId && m.role === "OWNER").length;
      },
      async listForUser(userId) {
        return [...members.values()]
          .filter((m) => m.userId === userId)
          .map((member) => ({ member, project: projects.get(member.projectId) as ProjectRecord }))
          .filter((x) => Boolean(x.project))
          .sort((a, b) => b.project.updatedAt.getTime() - a.project.updatedAt.getTime());
      },
    },
    files: {
      async listByProject(projectId) {
        return [...files.values()].filter((f) => f.projectId === projectId).sort((a, b) => a.path.localeCompare(b.path));
      },
      async findById(id) {
        return files.get(id) ?? null;
      },
      async findByPath(projectId, path) {
        return [...files.values()].find((f) => f.projectId === projectId && f.path === path) ?? null;
      },
      async create(data) {
        if ([...files.values()].some((f) => f.projectId === data.projectId && f.path === data.path)) {
          throw new UniqueViolationError("path");
        }
        const file: FileRecord = { id: randomUUID(), createdAt: now(), updatedAt: now(), ...data };
        files.set(file.id, file);
        return file;
      },
      async update(id, patch) {
        const file = files.get(id);
        if (!file) throw new Error("file not found");
        if (patch.path && patch.path !== file.path &&
            [...files.values()].some((f) => f.projectId === file.projectId && f.path === patch.path && f.id !== id)) {
          throw new UniqueViolationError("path");
        }
        const updated = { ...file, ...patch, updatedAt: now() };
        files.set(id, updated);
        return updated;
      },
      async remove(id) {
        deleteFileCascade(id);
      },
      async listDescendants(projectId, folderPath) {
        return [...files.values()]
          .filter((f) => f.projectId === projectId && f.path.startsWith(`${folderPath}/`))
          .sort((a, b) => a.path.localeCompare(b.path));
      },
    },
    versions: {
      async create(data) {
        const version: VersionRecord = {
          id: randomUUID(),
          createdAt: now(),
          source: data.source ?? "SAVE",
          label: data.label ?? null,
          ...data,
        };
        versions.set(version.id, version);
        return version;
      },
      async listByFile(fileId) {
        return [...versions.values()].filter((v) => v.fileId === fileId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async findById(id) {
        return versions.get(id) ?? null;
      },
      async latestForFile(fileId) {
        const list = [...versions.values()].filter((v) => v.fileId === fileId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return list[0] ?? null;
      },
    },
    invitations: {
      async create(data) {
        if ([...invitations.values()].some((i) => i.tokenHash === data.tokenHash)) {
          throw new UniqueViolationError("invitationToken");
        }
        const inv: InvitationRecord = { id: randomUUID(), status: "PENDING", createdAt: now(), updatedAt: now(), ...data };
        invitations.set(inv.id, inv);
        return inv;
      },
      async findById(id) {
        return invitations.get(id) ?? null;
      },
      async findByTokenHash(tokenHash) {
        return [...invitations.values()].find((i) => i.tokenHash === tokenHash) ?? null;
      },
      async findPending(projectId, email) {
        const list = [...invitations.values()]
          .filter((i) => i.projectId === projectId && i.email === email && i.status === "PENDING")
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return list[0] ?? null;
      },
      async listByProject(projectId) {
        return [...invitations.values()]
          .filter((i) => i.projectId === projectId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async listPendingForEmail(email) {
        return [...invitations.values()]
          .filter((i) => i.email === email && i.status === "PENDING")
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async updateStatus(id, status) {
        const inv = invitations.get(id);
        if (!inv) throw new Error("invitation not found");
        const updated = { ...inv, status, updatedAt: now() };
        invitations.set(id, updated);
        return updated;
      },
    },
    executions: {
      async create(data) {
        const record: ExecutionRecord = {
          id: randomUUID(),
          status: "QUEUED",
          stdout: null,
          stderr: null,
          exitCode: null,
          executionTime: null,
          createdAt: now(),
          updatedAt: now(),
          ...data,
        };
        executions.set(record.id, record);
        return record;
      },
      async findById(id) {
        return executions.get(id) ?? null;
      },
      async update(id, patch) {
        const existing = executions.get(id);
        if (!existing) throw new Error("execution not found");
        const updated = { ...existing, ...patch, updatedAt: now() };
        executions.set(id, updated);
        return updated;
      },
      async countActiveForUser(userId) {
        return [...executions.values()].filter(
          (e) => e.userId === userId && (e.status === "QUEUED" || e.status === "RUNNING"),
        ).length;
      },
      async listForUser(userId, limit = 20) {
        return [...executions.values()]
          .filter((e) => e.userId === userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit);
      },
    },
    messages: {
      async create(data) {
        const message: MessageRecord = { id: randomUUID(), createdAt: now(), ...data };
        messages.set(message.id, message);
        const sender = users.get(data.senderId);
        if (!sender) throw new Error("sender not found");
        return { message, sender };
      },
      async findById(id) {
        return messages.get(id) ?? null;
      },
      async listPage(projectId, opts) {
        const sorted = [...messages.values()]
          .filter((m) => m.projectId === projectId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
        const filtered = opts.before
          ? sorted.filter(
              (m) =>
                m.createdAt.getTime() < opts.before!.createdAt.getTime() ||
                (m.createdAt.getTime() === opts.before!.createdAt.getTime() && m.id < opts.before!.id),
            )
          : sorted;
        return filtered.slice(0, opts.limit).map((message) => ({ message, sender: users.get(message.senderId) as UserRecord }));
      },
    },
    async withTransaction(fn) {
      return fn(repos);
    },
    async ping() {
      return true;
    },
    reset() {
      users = new Map(); tokens = new Map(); projects = new Map();
      members = new Map(); files = new Map(); versions = new Map();
      invitations = new Map(); messages = new Map(); executions = new Map();
    },
  };
  return repos;
}
