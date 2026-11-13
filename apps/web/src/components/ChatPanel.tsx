import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { useChatStore, type ChatConnectionStatus } from "../stores/chatStore";
import { userColor } from "../lib/collab/colors";
import { cn } from "../lib/utils";
import { initialsOf } from "./CollaboratorAvatars";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Real project chat (Phase 4): REST history with cursor pagination + live
 * messages over the chat WebSocket. Sending is enabled for every project
 * member (including VIEWERs — a deliberate product choice, see docs/api.md).
 */

const STATUS_LABEL: Record<ChatConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Offline — reconnecting…",
  disconnected: "Disconnected",
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fullLabel(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function ChatPanel({ projectId }: { projectId: string }) {
  const user = useAuthStore((s) => s.user);
  const status = useChatStore((s) => s.connectionStatus);
  const messages = useChatStore((s) => s.messagesByProject[projectId]);
  const nextCursor = useChatStore((s) => s.nextCursorByProject[projectId]);
  const historyLoaded = useChatStore((s) => s.historyLoadedByProject[projectId]);
  const error = useChatStore((s) => s.error);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const send = useChatStore((s) => s.send);
  const clearError = useChatStore((s) => s.clearError);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const list = messages ?? [];
  const connected = status === "connected";

  // Keep the view pinned to the newest message as messages arrive / send.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length, projectId]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !draft.trim()) return;
    send(projectId, draft, { id: user.id, name: user.name });
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span
          aria-hidden
          className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : status === "disconnected" ? "bg-red-500" : "bg-amber-500")}
        />
        <span role="status" className="text-xs text-zinc-500 dark:text-zinc-400">{STATUS_LABEL[status]}</span>
        {error && (
          <button type="button" onClick={clearError} className="ml-auto truncate text-xs text-red-600 hover:underline dark:text-red-400" title={error}>
            {error}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {nextCursor && (
          <div className="pb-2 text-center">
            <Button type="button" size="sm" variant="outline" onClick={() => void loadOlder(projectId)}>
              Load older messages
            </Button>
          </div>
        )}
        {!historyLoaded ? (
          <p role="status" className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">Loading messages…</p>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <MessageSquare className="h-6 w-6 text-zinc-400" aria-hidden />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">No messages yet</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Say hello — messages are saved and shared with everyone in this workspace.</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Chat messages">
            {list.map((m) => {
              const color = userColor(m.sender.id).color;
              const mine = m.sender.id === user?.id;
              return (
                <li key={m.id} className="flex gap-2" data-testid="chat-message">
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: color }}
                    title={m.sender.name}
                  >
                    {m.sender.avatarUrl ? (
                      <img src={m.sender.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      initialsOf(m.sender.name)
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                        {m.sender.name}
                        {mine && <span className="font-normal text-zinc-400"> (you)</span>}
                      </span>
                      <time dateTime={m.createdAt} title={fullLabel(m.createdAt)} className="shrink-0 text-[11px] text-zinc-400">
                        {timeLabel(m.createdAt)}
                      </time>
                      {m.pending && <span className="shrink-0 text-[11px] italic text-zinc-400">sending…</span>}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-200">{m.content}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex shrink-0 gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? "Message the workspace…" : "Connect to chat to send messages"}
          aria-label="Chat message"
          disabled={!connected}
          maxLength={2000}
        />
        <Button type="submit" disabled={!connected || !draft.trim()} aria-label="Send message">
          Send
        </Button>
      </form>
      {!connected && (
        <p className="shrink-0 px-3 pb-2 text-[11px] text-zinc-400">
          {status === "disconnected" ? "Chat is disconnected — sending is unavailable." : "Connecting to chat — sending unlocks when the connection is live."}
        </p>
      )}
    </div>
  );
}
