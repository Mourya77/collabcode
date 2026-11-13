import type { ApiChatMessage, ApiPresenceUser } from "../api/types";

/**
 * WebSocket client for the Phase 4 chat gateway (apps/api, /api/chat/ws).
 *
 * Auth is the session cookie: browsers attach cookies to the WS handshake
 * automatically, and in dev the Vite proxy forwards them (ws: true). The
 * client subscribes to one project room per connection, reconnects with
 * exponential backoff after unexpected drops, and re-sends the last known
 * presence (active file) after every (re)subscribe.
 */

export type ChatConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ChatClientEvents {
  onStatus: (status: ChatConnectionStatus) => void;
  onMessage: (projectId: string, message: ApiChatMessage, clientMessageId?: string) => void;
  onPresence: (projectId: string, users: ApiPresenceUser[]) => void;
  onError?: (code: string, message: string) => void;
}

export interface ChatClient {
  connect: (projectId: string) => void;
  disconnect: () => void;
  sendMessage: (projectId: string, content: string, clientMessageId: string) => boolean;
  sendPresence: (projectId: string, activeFileId: string | null) => void;
  currentProjectId: () => string | null;
}

export function chatWsUrl(): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  if (base) return `${base.replace(/^http/, "ws")}/api/chat/ws`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/chat/ws`;
}

const MAX_BACKOFF_MS = 15_000;

export function createChatClient(events: ChatClientEvents): ChatClient {
  let ws: WebSocket | null = null;
  let projectId: string | null = null;
  let activeFileId: string | null = null;
  let closedByUser = false;
  let everConnected = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function send(frame: unknown): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }

  function open() {
    if (!projectId) return;
    events.onStatus(everConnected ? "reconnecting" : "connecting");
    const socket = new WebSocket(chatWsUrl());
    ws = socket;
    socket.onopen = () => {
      attempts = 0;
      everConnected = true;
      events.onStatus("connected");
      send({ type: "subscribe", projectId });
      // Re-announce presence (active file) for the fresh subscription.
      send({ type: "presence", projectId, activeFileId });
    };
    socket.onmessage = (ev) => {
      let frame: { type?: string; [k: string]: unknown };
      try {
        frame = JSON.parse(String(ev.data)) as typeof frame;
      } catch {
        return;
      }
      if (frame.type === "message" && frame.message) {
        const message = frame.message as ApiChatMessage;
        events.onMessage(message.projectId, message, typeof frame.clientMessageId === "string" ? frame.clientMessageId : undefined);
      } else if (frame.type === "presence" && typeof frame.projectId === "string" && Array.isArray(frame.users)) {
        events.onPresence(frame.projectId, frame.users as ApiPresenceUser[]);
      } else if (frame.type === "error") {
        events.onError?.(String(frame.code ?? "ERROR"), String(frame.message ?? "Chat error."));
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      if (closedByUser || !projectId) {
        events.onStatus("disconnected");
        return;
      }
      events.onStatus("reconnecting");
      const delay = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
      attempts += 1;
      reconnectTimer = setTimeout(open, delay);
    };
    socket.onerror = () => {
      // The close handler drives status + reconnect; nothing extra needed.
    };
  }

  return {
    connect(nextProjectId: string) {
      if (projectId === nextProjectId && (ws || reconnectTimer)) return;
      this.disconnect();
      closedByUser = false;
      projectId = nextProjectId;
      activeFileId = null;
      open();
    },
    disconnect() {
      closedByUser = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      projectId = null;
      if (ws) {
        const socket = ws;
        ws = null;
        socket.close();
      }
      events.onStatus("disconnected");
    },
    sendMessage(pid, content, clientMessageId) {
      if (pid !== projectId) return false;
      return send({ type: "message", projectId: pid, content, clientMessageId });
    },
    sendPresence(pid, nextActiveFileId) {
      activeFileId = nextActiveFileId;
      if (pid !== projectId) return;
      send({ type: "presence", projectId: pid, activeFileId: nextActiveFileId });
    },
    currentProjectId: () => projectId,
  };
}
