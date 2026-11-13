import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../lib/prisma.js";
import { UniqueViolationError } from "../utils/errors.js";
import type { ExecutionRecord, InvitationRole, Repos, VersionRecord } from "./types.js";

type Client = PrismaClient | Prisma.TransactionClient;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** Builds the full repository bundle bound to one (possibly transactional) Prisma client. */
export function makePrismaRepos(client: Client): Repos {
  const repos: Repos = {
    users: {
      async findByEmail(email) {
        return client.user.findUnique({ where: { email } });
      },
      async findById(id) {
        return client.user.findUnique({ where: { id } });
      },
      async create(data) {
        try {
          return await client.user.create({ data });
        } catch (e) {
          if (isUniqueViolation(e)) throw new UniqueViolationError("email");
          throw e;
        }
      },
      async update(id, patch) {
        return client.user.update({ where: { id }, data: patch });
      },
    },
    tokens: {
      async create(data) {
        return client.refreshToken.create({ data });
      },
      async findByHash(tokenHash) {
        return client.refreshToken.findUnique({ where: { tokenHash } });
      },
      async revoke(id) {
        await client.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
      },
      async revokeAllForUser(userId) {
        await client.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      },
    },
    projects: {
      async create(data) {
        return client.project.create({ data });
      },
      async findById(id) {
        return client.project.findUnique({ where: { id } });
      },
      async update(id, patch) {
        return client.project.update({ where: { id }, data: patch });
      },
      async remove(id) {
        await client.project.delete({ where: { id } });
      },
    },
    members: {
      async find(projectId, userId) {
        return client.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
      },
      async list(projectId) {
        return client.projectMember.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
      },
      async create(data) {
        try {
          return await client.projectMember.create({ data });
        } catch (e) {
          if (isUniqueViolation(e)) throw new UniqueViolationError("membership");
          throw e;
        }
      },
      async updateRole(projectId, userId, role) {
        return client.projectMember.update({ where: { projectId_userId: { projectId, userId } }, data: { role } });
      },
      async remove(projectId, userId) {
        await client.projectMember.delete({ where: { projectId_userId: { projectId, userId } } });
      },
      async countOwners(projectId) {
        return client.projectMember.count({ where: { projectId, role: "OWNER" } });
      },
      async listForUser(userId) {
        const rows = await client.projectMember.findMany({
          where: { userId },
          include: { project: true },
          orderBy: { project: { updatedAt: "desc" } },
        });
        return rows.map((r) => ({ member: r, project: r.project }));
      },
    },
    files: {
      async listByProject(projectId) {
        return client.file.findMany({ where: { projectId }, orderBy: { path: "asc" } });
      },
      async findById(id) {
        return client.file.findUnique({ where: { id } });
      },
      async findByPath(projectId, path) {
        return client.file.findUnique({ where: { projectId_path: { projectId, path } } });
      },
      async create(data) {
        try {
          return await client.file.create({ data });
        } catch (e) {
          if (isUniqueViolation(e)) throw new UniqueViolationError("path");
          throw e;
        }
      },
      async update(id, patch) {
        try {
          return await client.file.update({ where: { id }, data: patch });
        } catch (e) {
          if (isUniqueViolation(e)) throw new UniqueViolationError("path");
          throw e;
        }
      },
      async remove(id) {
        await client.file.delete({ where: { id } });
      },
      async listDescendants(projectId, folderPath) {
        return client.file.findMany({ where: { projectId, path: { startsWith: `${folderPath}/` } }, orderBy: { path: "asc" } });
      },
    },
    versions: {
      // Prisma types DocumentVersion.source as plain string; the API only
      // ever writes the VersionSource values, so rows are narrowed on exit.
      async create(data) {
        const row = await client.documentVersion.create({
          data: { ...data, source: data.source ?? "SAVE", label: data.label ?? null },
        });
        return { ...row, source: row.source as VersionRecord["source"] };
      },
      async listByFile(fileId) {
        const rows = await client.documentVersion.findMany({ where: { fileId }, orderBy: { createdAt: "desc" } });
        return rows.map((row) => ({ ...row, source: row.source as VersionRecord["source"] }));
      },
      async findById(id) {
        const row = await client.documentVersion.findUnique({ where: { id } });
        return row ? { ...row, source: row.source as VersionRecord["source"] } : null;
      },
      async latestForFile(fileId) {
        const row = await client.documentVersion.findFirst({ where: { fileId }, orderBy: { createdAt: "desc" } });
        return row ? { ...row, source: row.source as VersionRecord["source"] } : null;
      },
    },
    invitations: {
      // Prisma types Invitation.role as the full ProjectRole enum; the API
      // only ever writes EDITOR/VIEWER (enforced by the invitations service),
      // so rows are narrowed to InvitationRole on the way out.
      async create(data) {
        try {
          const row = await client.invitation.create({ data });
          return { ...row, role: row.role as InvitationRole };
        } catch (e) {
          if (isUniqueViolation(e)) throw new UniqueViolationError("invitationToken");
          throw e;
        }
      },
      async findById(id) {
        const row = await client.invitation.findUnique({ where: { id } });
        return row ? { ...row, role: row.role as InvitationRole } : null;
      },
      async findByTokenHash(tokenHash) {
        const row = await client.invitation.findUnique({ where: { tokenHash } });
        return row ? { ...row, role: row.role as InvitationRole } : null;
      },
      async findPending(projectId, email) {
        const row = await client.invitation.findFirst({
          where: { projectId, email, status: "PENDING" },
          orderBy: { createdAt: "desc" },
        });
        return row ? { ...row, role: row.role as InvitationRole } : null;
      },
      async listByProject(projectId) {
        const rows = await client.invitation.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
        return rows.map((row) => ({ ...row, role: row.role as InvitationRole }));
      },
      async listPendingForEmail(email) {
        const rows = await client.invitation.findMany({
          where: { email, status: "PENDING" },
          orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => ({ ...row, role: row.role as InvitationRole }));
      },
      async updateStatus(id, status) {
        const row = await client.invitation.update({ where: { id }, data: { status } });
        return { ...row, role: row.role as InvitationRole };
      },
    },
    executions: {
      async create(data) {
        const row = await client.execution.create({ data });
        return { ...row, status: row.status as ExecutionRecord["status"] };
      },
      async findById(id) {
        const row = await client.execution.findUnique({ where: { id } });
        return row ? { ...row, status: row.status as ExecutionRecord["status"] } : null;
      },
      async update(id, patch) {
        const row = await client.execution.update({ where: { id }, data: patch });
        return { ...row, status: row.status as ExecutionRecord["status"] };
      },
      async countActiveForUser(userId) {
        return client.execution.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } });
      },
      async listForUser(userId, limit = 20) {
        const rows = await client.execution.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return rows.map((row) => ({ ...row, status: row.status as ExecutionRecord["status"] }));
      },
    },
    messages: {
      async create(data) {
        const row = await client.chatMessage.create({ data, include: { sender: true } });
        const { sender, ...message } = row;
        return { message, sender };
      },
      async findById(id) {
        return client.chatMessage.findUnique({ where: { id } });
      },
      async listPage(projectId, opts) {
        const rows = await client.chatMessage.findMany({
          where: {
            projectId,
            ...(opts.before
              ? {
                  OR: [
                    { createdAt: { lt: opts.before.createdAt } },
                    { createdAt: opts.before.createdAt, id: { lt: opts.before.id } },
                  ],
                }
              : {}),
          },
          include: { sender: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: opts.limit,
        });
        return rows.map(({ sender, ...message }) => ({ message, sender }));
      },
    },
    async withTransaction(fn) {
      if ("$transaction" in client) {
        return (client as PrismaClient).$transaction(async (tx) => fn(makePrismaRepos(tx)));
      }
      // Already inside a transaction: reuse the same client.
      return fn(repos);
    },
    async ping() {
      try {
        await (client as PrismaClient).$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
  return repos;
}

/** Default bundle over the lazily-created global Prisma client. */
export const prismaRepos: Repos = makePrismaRepos(new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = getPrisma();
    const v = (c as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
}));
