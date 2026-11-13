import type { Repos } from "../../repositories/types.js";
import { badRequest } from "../../utils/errors.js";
import { presenceRegistry, type PresenceRegistry } from "./presence.js";
import { validateMessageContent } from "./schemas.js";
import { toMessageDto, type MessageDto, type MessagePageDto, type PresenceDto } from "./types.js";

export class ChatService {
  constructor(
    private readonly repos: Repos,
    private readonly presence: PresenceRegistry = presenceRegistry,
  ) {}

  /** Newest-first page of history; `cursor` is the id of the oldest message of the previous page. */
  async listMessages(projectId: string, opts: { cursor?: string; limit: number }): Promise<MessagePageDto> {
    let before;
    if (opts.cursor) {
      before = await this.repos.messages.findById(opts.cursor);
      if (!before || before.projectId !== projectId) {
        throw badRequest("Invalid pagination cursor for this project.");
      }
    }
    const rows = await this.repos.messages.listPage(projectId, { limit: opts.limit, ...(before ? { before } : {}) });
    const messages = rows.map(toMessageDto);
    return {
      messages,
      nextCursor: rows.length === opts.limit ? (rows[rows.length - 1]?.message.id ?? null) : null,
    };
  }

  /** Persists a message (used by the WebSocket gateway after validation). */
  async postMessage(projectId: string, senderId: string, rawContent: unknown): Promise<MessageDto> {
    const v = validateMessageContent(rawContent);
    if (!v.ok) throw badRequest(v.error);
    const row = await this.repos.messages.create({ projectId, senderId, content: v.content });
    return toMessageDto(row);
  }

  /** DB members merged with the live registry: who is a member vs who is online now. */
  async getPresence(projectId: string): Promise<PresenceDto> {
    const memberRows = await this.repos.members.list(projectId);
    const online = this.presence.onlineUsers(projectId);
    const members: PresenceDto["members"] = [];
    for (const m of memberRows) {
      const user = await this.repos.users.findById(m.userId);
      if (!user) continue;
      const isOnline = this.presence.isOnline(projectId, m.userId);
      const seen = isOnline
        ? (online.find((o) => o.userId === m.userId)?.lastSeenAt ?? null)
        : (this.presence.lastSeenAt(m.userId)?.toISOString() ?? null);
      members.push({
        userId: m.userId,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: m.role,
        online: isOnline,
        activeFileId: isOnline ? this.presence.activeFileOf(projectId, m.userId) : null,
        lastSeenAt: seen,
      });
    }
    return { online, members };
  }
}
