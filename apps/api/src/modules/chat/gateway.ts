import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "../../config/env.js";
import type { Repos } from "../../repositories/types.js";
import { ACCESS_COOKIE } from "../../utils/cookies.js";
import { ApiError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { verifyAccessToken } from "../../utils/tokens.js";
import { presenceRegistry, type PresenceRegistry } from "./presence.js";
import { validateMessageContent } from "./schemas.js";
import { ChatService } from "./service.js";

/**
 * Real-time chat gateway (Phase 4): a `ws` WebSocketServer attached to the
 * API's HTTP server at /api/chat/ws.
 *
 * - Auth happens ONCE at upgrade time from the `cc_access` httpOnly cookie
 *   (the same JWT the REST API uses). Browsers send the cookie automatically;
 *   there is no token-in-URL fallback.
 * - Project rooms are joined explicitly with a `subscribe` frame and are
 *   ALWAYS authorized against the database membership table — a client-sent
 *   projectId is never trusted on its own. Non-members get an error frame
 *   and the socket is closed.
 * - Every chat member (OWNER/EDITOR/VIEWER) may read and send messages.
 * - Presence (modules/chat/presence.ts) is driven by subscribe/presence
 *   frames and socket close; joins/leaves/changes are broadcast to the room.
 *
 * Frame protocol (JSON): see docs/api.md "Chat WebSocket protocol".
 */
export const CHAT_WS_PATH = "/api/chat/ws";
const HEARTBEAT_MS = 30_000;
/**
 * Phase 7 hardening:
 * - MAX_PAYLOAD caps a single frame (chat content itself is ≤ 2000 chars;
 *   32 KiB leaves ample room for JSON framing) — `ws` closes the socket
 *   with 1009 when a peer exceeds it.
 * - A per-socket sliding-window frame budget stops one authenticated
 *   client from flooding a room (and the database) with messages.
 */
const MAX_PAYLOAD_BYTES = 32 * 1024;
const RATE_MAX_FRAMES = 30;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_VIOLATIONS = 3;

interface ClientState {
  connectionId: string;
  userId: string;
  name: string;
  rooms: Set<string>;
  isAlive: boolean;
  framesInWindow: number;
  windowStartedAt: number;
  rateViolations: number;
}

export interface ChatRateLimit {
  maxFrames: number;
  windowMs: number;
  maxViolations: number;
}

type Frame = Record<string, unknown>;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function send(ws: WebSocket, frame: Frame): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: "error", code, message });
}

export interface ChatGateway {
  wss: WebSocketServer;
  close: () => void;
}

export function attachChatGateway(
  server: HttpServer,
  repos: Repos,
  opts: { presence?: PresenceRegistry; heartbeatMs?: number; rateLimit?: Partial<ChatRateLimit> } = {},
): ChatGateway {
  const presence = opts.presence ?? presenceRegistry;
  const chat = new ChatService(repos, presence);
  const rateLimit: ChatRateLimit = {
    maxFrames: opts.rateLimit?.maxFrames ?? RATE_MAX_FRAMES,
    windowMs: opts.rateLimit?.windowMs ?? RATE_WINDOW_MS,
    maxViolations: opts.rateLimit?.maxViolations ?? RATE_MAX_VIOLATIONS,
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const rooms = new Map<string, Set<WebSocket>>();
  const states = new Map<WebSocket, ClientState>();

  function broadcastPresence(projectId: string): void {
    const frame: Frame = { type: "presence", projectId, users: presence.onlineUsers(projectId) };
    for (const ws of rooms.get(projectId) ?? []) send(ws, frame);
  }

  function broadcast(projectId: string, frame: Frame): void {
    for (const ws of rooms.get(projectId) ?? []) send(ws, frame);
  }

  async function handleFrame(ws: WebSocket, state: ClientState, frame: Frame): Promise<void> {
    switch (frame.type) {
      case "subscribe": {
        const projectId = frame.projectId;
        if (typeof projectId !== "string" || projectId.length === 0) {
          sendError(ws, "VALIDATION_ERROR", "subscribe requires a projectId string.");
          return;
        }
        const member = await repos.members.find(projectId, state.userId);
        if (!member) {
          sendError(ws, "FORBIDDEN", "You are not a member of that project.");
          ws.close(4403, "Forbidden");
          return;
        }
        if (!state.rooms.has(projectId)) {
          state.rooms.add(projectId);
          let room = rooms.get(projectId);
          if (!room) {
            room = new Set();
            rooms.set(projectId, room);
          }
          room.add(ws);
          presence.join(projectId, state.connectionId, { id: state.userId, name: state.name });
        }
        send(ws, { type: "subscribed", projectId });
        broadcastPresence(projectId);
        return;
      }
      case "message": {
        const projectId = frame.projectId;
        if (typeof projectId !== "string" || !state.rooms.has(projectId)) {
          sendError(ws, "FORBIDDEN", "Subscribe to the project before sending messages.");
          return;
        }
        const v = validateMessageContent(frame.content);
        if (!v.ok) {
          sendError(ws, "VALIDATION_ERROR", v.error);
          return;
        }
        const dto = await chat.postMessage(projectId, state.userId, v.content);
        presence.touch(state.userId);
        broadcast(projectId, {
          type: "message",
          message: dto,
          ...(typeof frame.clientMessageId === "string" ? { clientMessageId: frame.clientMessageId } : {}),
        });
        return;
      }
      case "presence": {
        const projectId = frame.projectId;
        if (typeof projectId !== "string" || !state.rooms.has(projectId)) {
          sendError(ws, "FORBIDDEN", "Subscribe to the project before sending presence.");
          return;
        }
        const activeFileId = frame.activeFileId ?? null;
        if (activeFileId !== null && typeof activeFileId !== "string") {
          sendError(ws, "VALIDATION_ERROR", "activeFileId must be a string or null.");
          return;
        }
        presence.setActiveFile(projectId, state.userId, activeFileId);
        broadcastPresence(projectId);
        return;
      }
      case "ping": {
        presence.touch(state.userId);
        send(ws, { type: "pong" });
        return;
      }
      default:
        sendError(ws, "UNKNOWN_TYPE", `Unknown frame type: ${String(frame.type)}`);
    }
  }

  wss.on("connection", (ws: WebSocket, user: { id: string; name: string }) => {
    const state: ClientState = {
      connectionId: randomUUID(),
      userId: user.id,
      name: user.name,
      rooms: new Set(),
      isAlive: true,
      framesInWindow: 0,
      windowStartedAt: Date.now(),
      rateViolations: 0,
    };
    states.set(ws, state);
    ws.on("pong", () => {
      state.isAlive = true;
    });
    ws.on("message", (data) => {
      // Per-socket rate budget (Phase 7): every frame counts, including
      // pings — a flooding client gets RATE_LIMITED frames and is closed
      // after repeated violations.
      const now = Date.now();
      if (now - state.windowStartedAt >= rateLimit.windowMs) {
        state.windowStartedAt = now;
        state.framesInWindow = 0;
        state.rateViolations = 0;
      }
      state.framesInWindow += 1;
      if (state.framesInWindow > rateLimit.maxFrames) {
        state.rateViolations += 1;
        sendError(ws, "RATE_LIMITED", "You are sending messages too quickly. Please slow down.");
        if (state.rateViolations >= rateLimit.maxViolations) {
          ws.close(4429, "Rate limit exceeded");
        }
        return;
      }
      let frame: Frame;
      try {
        frame = JSON.parse(data.toString()) as Frame;
        if (typeof frame !== "object" || frame === null) throw new Error("not an object");
      } catch {
        sendError(ws, "VALIDATION_ERROR", "Frames must be JSON objects.");
        return;
      }
      void handleFrame(ws, state, frame).catch((e: unknown) => {
        if (e instanceof ApiError) sendError(ws, e.code, e.message);
        else {
          logger.error({ err: e }, "chat gateway frame failed");
          sendError(ws, "INTERNAL", "Something went wrong handling that frame.");
        }
      });
    });
    const cleanup = () => {
      for (const projectId of state.rooms) {
        const room = rooms.get(projectId);
        room?.delete(ws);
        if (room && room.size === 0) rooms.delete(projectId);
        const wentOffline = presence.leave(projectId, state.connectionId, state.userId);
        if (wentOffline) broadcastPresence(projectId);
      }
      state.rooms.clear();
      states.delete(ws);
    };
    ws.on("close", cleanup);
    ws.on("error", (err) => {
      logger.warn({ err }, "chat gateway socket error");
      cleanup();
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== CHAT_WS_PATH) {
      socket.destroy();
      return;
    }
    // Cross-site WebSocket hijacking guard (Phase 7): the gateway is
    // cookie-authenticated, so a browser page from a foreign origin must
    // never be able to open it. Requests WITHOUT an Origin header are not
    // browsers (native clients, tests) and are left to cookie auth.
    const origin = req.headers.origin;
    if (origin && !env.CORS_ORIGINS_LIST.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    void (async () => {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[ACCESS_COOKIE];
      const payload = token ? verifyAccessToken(token) : null;
      const user = payload ? await repos.users.findById(payload.userId) : null;
      if (!payload || !user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, { id: user.id, name: user.name });
      });
    })().catch((e: unknown) => {
      logger.error({ err: e }, "chat gateway upgrade failed");
      socket.destroy();
    });
  });

  const heartbeat = setInterval(() => {
    for (const [ws, state] of states) {
      if (!state.isAlive) {
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
  }, opts.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    wss,
    close: () => {
      clearInterval(heartbeat);
      for (const ws of states.keys()) ws.terminate();
      wss.close();
    },
  };
}
