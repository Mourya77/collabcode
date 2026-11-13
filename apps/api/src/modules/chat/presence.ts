/**
 * Workspace presence registry (Phase 4) — who is connected to a project's
 * chat/workspace right now, which file they are looking at, and when each
 * user was last active.
 *
 * This is deliberately distinct from the Phase 3 Yjs Awareness state:
 * awareness is per-DOCUMENT (one open file), while this registry is
 * per-PROJECT (the whole workspace: chat subscribers, including people with
 * no file open).
 *
 * In-memory and single-process by design: the API gateway holds it, and the
 * REST presence endpoint reads the same instance. Horizontal scaling
 * (Redis-backed presence) is Phase 6 — until then presence is accurate for
 * the single API process, which is the documented deployment shape.
 */

export interface OnlineUser {
  userId: string;
  name: string;
  activeFileId: string | null;
  connectedAt: string;
  lastSeenAt: string;
}

interface Entry {
  userId: string;
  name: string;
  activeFileId: string | null;
  connectedAt: Date;
  lastSeenAt: Date;
  connections: Set<string>;
}

export class PresenceRegistry {
  /** projectId -> userId -> entry */
  private readonly projects = new Map<string, Map<string, Entry>>();
  /** userId -> last disconnect/activity time (survives disconnect). */
  private readonly lastSeen = new Map<string, Date>();

  join(projectId: string, connectionId: string, user: { id: string; name: string }): OnlineUser {
    let room = this.projects.get(projectId);
    if (!room) {
      room = new Map();
      this.projects.set(projectId, room);
    }
    const now = new Date();
    let entry = room.get(user.id);
    if (!entry) {
      entry = {
        userId: user.id,
        name: user.name,
        activeFileId: null,
        connectedAt: now,
        lastSeenAt: now,
        connections: new Set(),
      };
      room.set(user.id, entry);
    }
    entry.connections.add(connectionId);
    entry.lastSeenAt = now;
    entry.name = user.name;
    return PresenceRegistry.toOnline(entry);
  }

  /** Removes one connection; returns true when the user went fully offline. */
  leave(projectId: string, connectionId: string, userId: string): boolean {
    const room = this.projects.get(projectId);
    const entry = room?.get(userId);
    if (!room || !entry) return false;
    entry.connections.delete(connectionId);
    const now = new Date();
    entry.lastSeenAt = now;
    this.lastSeen.set(userId, now);
    if (entry.connections.size > 0) return false;
    room.delete(userId);
    if (room.size === 0) this.projects.delete(projectId);
    return true;
  }

  setActiveFile(projectId: string, userId: string, activeFileId: string | null): OnlineUser | null {
    const entry = this.projects.get(projectId)?.get(userId);
    if (!entry) return null;
    entry.activeFileId = activeFileId;
    entry.lastSeenAt = new Date();
    return PresenceRegistry.toOnline(entry);
  }

  touch(userId: string): void {
    this.lastSeen.set(userId, new Date());
  }

  onlineUsers(projectId: string): OnlineUser[] {
    const room = this.projects.get(projectId);
    if (!room) return [];
    return [...room.values()]
      .map((e) => PresenceRegistry.toOnline(e))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  isOnline(projectId: string, userId: string): boolean {
    return this.projects.get(projectId)?.has(userId) ?? false;
  }

  activeFileOf(projectId: string, userId: string): string | null {
    return this.projects.get(projectId)?.get(userId)?.activeFileId ?? null;
  }

  lastSeenAt(userId: string): Date | null {
    return this.lastSeen.get(userId) ?? null;
  }

  private static toOnline(e: Entry): OnlineUser {
    return {
      userId: e.userId,
      name: e.name,
      activeFileId: e.activeFileId,
      connectedAt: e.connectedAt.toISOString(),
      lastSeenAt: e.lastSeenAt.toISOString(),
    };
  }
}

/** The single registry shared by the chat gateway and the REST endpoint. */
export const presenceRegistry = new PresenceRegistry();
