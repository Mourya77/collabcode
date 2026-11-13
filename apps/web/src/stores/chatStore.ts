import { create } from "zustand";
import { chatApi } from "../lib/api/chat";
import { ApiClientError } from "../lib/api/client";
import type { ApiChatMessage, ApiPresenceUser } from "../lib/api/types";
import { createChatClient, type ChatClient, type ChatConnectionStatus } from "../lib/chat/chatClient";

/**
 * Workspace chat state (Phase 4). Messages come from two sources that are
 * reconciled here:
 *  - REST history (cursor-paginated, newest-first pages), and
 *  - the live WebSocket gateway, which broadcasts every persisted message
 *    (including the sender's own, echoed with its clientMessageId).
 * Optimistic sends render immediately and are replaced by the server copy
 * when the echo arrives — matched by clientMessageId, so no duplicates.
 */

export interface ChatMessage extends ApiChatMessage {
  pending?: boolean;
  clientMessageId?: string;
}

export type { ChatConnectionStatus };

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

/** Chronological order; ISO timestamps sort lexicographically, id breaks ties. */
function byTime(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mergeMessages(existing: ChatMessage[], incoming: ApiChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }
  return [...byId.values()].sort(byTime);
}

interface ChatState {
  connectionStatus: ChatConnectionStatus;
  messagesByProject: Record<string, ChatMessage[]>;
  nextCursorByProject: Record<string, string | null>;
  historyLoadedByProject: Record<string, boolean>;
  presenceByProject: Record<string, ApiPresenceUser[]>;
  error: string | null;
  connect: (projectId: string) => void;
  disconnect: () => void;
  loadHistory: (projectId: string) => Promise<void>;
  loadOlder: (projectId: string) => Promise<void>;
  send: (projectId: string, content: string, me: { id: string; name: string }) => void;
  setActiveFile: (projectId: string, activeFileId: string | null) => void;
  clearError: () => void;
}

let client: ChatClient | null = null;
let seq = 0;

export const useChatStore = create<ChatState>((set, get) => {
  function ensureClient(): ChatClient {
    client ??= createChatClient({
      onStatus: (status) => set({ connectionStatus: status }),
      onMessage: (projectId, message, clientMessageId) => {
        set((s) => {
          const list = s.messagesByProject[projectId] ?? [];
          // Reconcile the optimistic copy: same clientMessageId → replace it
          // with the persisted message (real id + server timestamp).
          const withoutOptimistic = clientMessageId
            ? list.filter((m) => !(m.pending && m.clientMessageId === clientMessageId))
            : list;
          return { messagesByProject: { ...s.messagesByProject, [projectId]: mergeMessages(withoutOptimistic, [message]) } };
        });
      },
      onPresence: (projectId, users) => {
        set((s) => ({ presenceByProject: { ...s.presenceByProject, [projectId]: users } }));
      },
      onError: (_code, message) => set({ error: message }),
    });
    return client;
  }

  return {
    connectionStatus: "disconnected",
    messagesByProject: {},
    nextCursorByProject: {},
    historyLoadedByProject: {},
    presenceByProject: {},
    error: null,

    connect(projectId) {
      ensureClient().connect(projectId);
      if (!get().historyLoadedByProject[projectId]) void get().loadHistory(projectId);
    },

    disconnect() {
      client?.disconnect();
      set({ connectionStatus: "disconnected" });
    },

    async loadHistory(projectId) {
      try {
        const page = await chatApi.listMessages(projectId, { limit: 50 });
        set((s) => ({
          messagesByProject: { ...s.messagesByProject, [projectId]: mergeMessages(s.messagesByProject[projectId] ?? [], page.messages) },
          nextCursorByProject: { ...s.nextCursorByProject, [projectId]: page.nextCursor },
          historyLoadedByProject: { ...s.historyLoadedByProject, [projectId]: true },
        }));
      } catch (e) {
        set({ error: messageOf(e, "Could not load chat history.") });
      }
    },

    async loadOlder(projectId) {
      const cursor = get().nextCursorByProject[projectId];
      if (!cursor) return;
      try {
        const page = await chatApi.listMessages(projectId, { limit: 50, cursor });
        set((s) => ({
          messagesByProject: { ...s.messagesByProject, [projectId]: mergeMessages(s.messagesByProject[projectId] ?? [], page.messages) },
          nextCursorByProject: { ...s.nextCursorByProject, [projectId]: page.nextCursor },
        }));
      } catch (e) {
        set({ error: messageOf(e, "Could not load older messages.") });
      }
    },

    send(projectId, content, me) {
      const text = content.trim();
      if (!text) return;
      const clientMessageId = `cm-${Date.now()}-${++seq}`;
      const optimistic: ChatMessage = {
        id: `optimistic-${clientMessageId}`,
        projectId,
        content: text,
        createdAt: new Date().toISOString(),
        sender: { id: me.id, name: me.name, avatarUrl: null },
        pending: true,
        clientMessageId,
      };
      const sent = ensureClient().sendMessage(projectId, text, clientMessageId);
      if (!sent) {
        set({ error: "Not connected — your message was not sent." });
        return;
      }
      set((s) => ({
        messagesByProject: { ...s.messagesByProject, [projectId]: [...(s.messagesByProject[projectId] ?? []), optimistic] },
        error: null,
      }));
    },

    setActiveFile(projectId, activeFileId) {
      client?.sendPresence(projectId, activeFileId);
    },

    clearError: () => set({ error: null }),
  };
});
