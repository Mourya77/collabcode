import { useCallback, useEffect, useState } from "react";
import { invitationsApi } from "../lib/api/invitations";
import { projectsApi } from "../lib/api/projects";
import { ApiClientError } from "../lib/api/client";
import type { ApiInvitation, InvitableRole, InvitationStatus } from "../lib/api/types";
import { userColor } from "../lib/collab/colors";
import { useAuthStore } from "../stores/authStore";
import { useProjectStore } from "../stores/projectStore";
import { cn } from "../lib/utils";
import { initialsOf } from "./CollaboratorAvatars";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
}

const STATUS_STYLES: Record<InvitationStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  ACCEPTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  DECLINED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  REVOKED: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  EXPIRED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

/**
 * Member management (Phase 4): the Members tab lists everyone with their
 * role — the OWNER can change roles and remove members (the API enforces
 * the last-owner and no-self-role-change rules and their errors surface
 * here). The Invitations tab shows the v2 invite flow state with revoke.
 */
export function MembersModal({ open, onOpenChange, projectName }: Props) {
  const project = useProjectStore((s) => s.currentProject);
  const members = useProjectStore((s) => s.members);
  const fetchMembers = useProjectStore((s) => s.fetchMembers);
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const projectId = project?.id;
  const isOwner = project?.role === "OWNER";

  const loadInvitations = useCallback(async () => {
    if (!projectId || !isOwner) return;
    try {
      setInvitations(await invitationsApi.list(projectId));
    } catch (e) {
      setError(messageOf(e, "Could not load invitations."));
    }
  }, [projectId, isOwner]);

  useEffect(() => {
    if (!open || !projectId) return;
    setError(null);
    void fetchMembers(projectId);
    if (tab === "invitations") void loadInvitations();
  }, [open, projectId, tab, fetchMembers, loadInvitations]);

  async function changeRole(userId: string, role: InvitableRole) {
    if (!projectId) return;
    setBusy(userId);
    setError(null);
    try {
      await projectsApi.updateMemberRole(projectId, userId, role);
      await fetchMembers(projectId);
    } catch (e) {
      setError(messageOf(e, "Could not change that role."));
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(userId: string, name: string) {
    if (!projectId) return;
    setBusy(userId);
    setError(null);
    try {
      await projectsApi.removeMember(projectId, userId);
      await fetchMembers(projectId);
    } catch (e) {
      setError(messageOf(e, `Could not remove ${name}.`));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(invitation: ApiInvitation) {
    if (!projectId) return;
    setBusy(invitation.id);
    setError(null);
    try {
      await invitationsApi.revoke(projectId, invitation.id);
      await loadInvitations();
    } catch (e) {
      setError(messageOf(e, "Could not revoke that invitation."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Members of ${projectName}`} description="Roles and invitations for this workspace.">
      <div role="tablist" aria-label="Member management" className="mb-3 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(["members", "invitations"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 text-sm font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
              tab === t ? "border-b-2 border-sky-500 text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {tab === "members" && (
        <ul className="space-y-1" aria-label="Project members">
          {members.map((m) => {
            const color = userColor(m.userId).color;
            const isSelf = m.userId === me?.id;
            return (
              <li key={m.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: color }}>
                  {initialsOf(m.user.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {m.user.name} {isSelf && <span className="text-zinc-400">(you)</span>}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{m.user.email}</span>
                </span>
                {isOwner && !isSelf && m.role !== "OWNER" ? (
                  <>
                    <select
                      aria-label={`Role for ${m.user.name}`}
                      value={m.role}
                      disabled={busy === m.userId}
                      onChange={(e) => void changeRole(m.userId, e.target.value as InvitableRole)}
                      className="h-8 rounded-md border border-zinc-300 bg-white px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <Button type="button" size="sm" variant="outline" disabled={busy === m.userId} onClick={() => void removeMember(m.userId, m.user.name)} aria-label={`Remove ${m.user.name}`}>
                      Remove
                    </Button>
                  </>
                ) : (
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{m.role}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "invitations" &&
        (isOwner ? (
          invitations.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">No invitations yet. Use the Invite button to invite someone by email.</p>
          ) : (
            <ul className="space-y-1" aria-label="Project invitations">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{inv.email}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {inv.role} · invited by {members.find((m) => m.userId === inv.invitedById)?.user.name ?? "the owner"} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_STYLES[inv.status])}>
                    {inv.status.toLowerCase()}
                  </span>
                  {inv.status === "PENDING" && (
                    <Button type="button" size="sm" variant="outline" disabled={busy === inv.id} onClick={() => void revoke(inv)} aria-label={`Revoke invitation for ${inv.email}`}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">Only the project owner can view and manage invitations.</p>
        ))}
    </Modal>
  );
}
