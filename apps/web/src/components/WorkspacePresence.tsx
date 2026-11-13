import { useEffect, useMemo, useState } from "react";
import { chatApi } from "../lib/api/chat";
import type { ApiFile, ApiMember, ApiPresence } from "../lib/api/types";
import { userColor } from "../lib/collab/colors";
import { useChatStore } from "../stores/chatStore";

/**
 * Workspace presence (Phase 4) — who is in this workspace right now, which
 * file they have open, and when offline members were last active. This is
 * the chat-gateway presence system; it is deliberately separate from the
 * Phase 3 document-level awareness shown in the editor header (that one is
 * per open document, this one is per workspace).
 */

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "Offline";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Last active just now";
  if (minutes < 60) return `Last active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last active ${days}d ago`;
}

interface Props {
  projectId: string;
  members: ApiMember[];
  files: ApiFile[];
  currentUserId: string;
}

export function WorkspacePresence({ projectId, members, files, currentUserId }: Props) {
  const livePresence = useChatStore((s) => s.presenceByProject[projectId]);
  const [rest, setRest] = useState<ApiPresence | null>(null);

  // REST presence supplies the full member roster + lastSeenAt; refetch when
  // the live WS presence set changes so offline/last-active stays fresh.
  useEffect(() => {
    let cancelled = false;
    chatApi
      .presence(projectId)
      .then((p) => {
        if (!cancelled) setRest(p);
      })
      .catch(() => {
        // Presence is auxiliary; the WS-driven list below still works.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, livePresence]);

  const fileNameById = useMemo(() => new Map(files.map((f) => [f.id, f.name])), [files]);

  const online = useMemo(() => {
    // Live WS frames win; before the first frame, fall back to REST.
    const source = livePresence ?? rest?.online ?? [];
    return source.map((u) => ({
      userId: u.userId,
      name: u.name,
      activeFileId: u.activeFileId,
      fileName: u.activeFileId ? (fileNameById.get(u.activeFileId) ?? "a file") : null,
    }));
  }, [livePresence, rest, fileNameById]);

  const onlineIds = useMemo(() => new Set(online.map((u) => u.userId)), [online]);
  const lastSeenById = useMemo(() => new Map((rest?.members ?? []).map((m) => [m.userId, m.lastSeenAt])), [rest]);
  const offline = members.filter((m) => !onlineIds.has(m.userId));

  return (
    <section aria-label="Workspace presence">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Workspace</h3>
      <ul className="mt-2 space-y-1" aria-label="Online now">
        {online.map((u) => (
          <li key={u.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: userColor(u.userId).color }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {u.name} {u.userId === currentUserId && <span className="text-zinc-400">(you)</span>}
              </span>
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {u.fileName ? `Editing ${u.fileName}` : "No file open"}
              </span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Online</span>
          </li>
        ))}
        {online.length === 0 && <li className="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">Nobody is connected right now.</li>}
      </ul>
      {offline.length > 0 && (
        <>
          <h4 className="mt-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Offline</h4>
          <ul className="mt-1 space-y-1" aria-label="Offline members">
            {offline.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm opacity-70">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {m.user.name} {m.userId === currentUserId && <span className="text-zinc-400">(you)</span>}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{relativeTime(lastSeenById.get(m.userId) ?? null)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
