import type { ApiMember } from "../lib/api/types";
import type { LiveUser } from "../lib/collab/presence";

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Avatar stack for a project. Phase 3: when live awareness users are
 * available they take precedence — each avatar uses the user's stable
 * collaboration colour and marks the current user as "(you)". Otherwise it
 * falls back to the API member list with role-based colours.
 */
export function CollaboratorAvatars({
  members,
  currentUserId,
  liveUsers,
}: {
  members: ApiMember[];
  currentUserId: string;
  liveUsers?: LiveUser[];
}) {
  if (liveUsers && liveUsers.length > 0) {
    return (
      <div className="flex -space-x-2" aria-label="Live collaborators">
        {liveUsers.slice(0, 5).map((u) => (
          <span
            key={u.clientId}
            title={`${u.name}${u.isSelf ? " (you)" : ""} — live now`}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900"
            style={{ backgroundColor: u.color }}
          >
            {initialsOf(u.name)}
          </span>
        ))}
        {liveUsers.length > 5 ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900">
            +{liveUsers.length - 5}
          </span>
        ) : null}
      </div>
    );
  }

  if (members.length === 0) return null;
  return (
    <div className="flex -space-x-2" aria-label="Collaborators">
      {members.slice(0, 5).map((m) => (
        <span
          key={m.userId}
          title={`${m.user.name} — ${m.role}${m.userId === currentUserId ? " (you)" : ""}`}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900 ${
            m.role === "OWNER" ? "bg-violet-600" : m.role === "EDITOR" ? "bg-sky-600" : "bg-zinc-500"
          }`}
        >
          {initialsOf(m.user.name)}
        </span>
      ))}
      {members.length > 5 ? (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900">
          +{members.length - 5}
        </span>
      ) : null}
    </div>
  );
}
