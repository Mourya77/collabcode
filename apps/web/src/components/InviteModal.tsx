import { useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { invitationsApi } from "../lib/api/invitations";
import { ApiClientError } from "../lib/api/client";
import type { ApiInvitationCreated, InvitableRole } from "../lib/api/types";
import { useProjectStore } from "../stores/projectStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Modal } from "./ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invite by email — invitations v2 (Phase 4). Creating an invitation does
 * NOT add a member: the invitee joins only when they accept the link.
 * Email delivery is not configured in development, so the API returns the
 * invite link and we show it here for manual sharing.
 */
export function InviteModal({ open, onOpenChange, projectName }: Props) {
  const projectId = useProjectStore((s) => s.currentProject?.id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("EDITOR");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiInvitationCreated | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId) {
      setError("No project is open.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address.");
      setCreated(null);
      return;
    }
    setSending(true);
    setError(null);
    setCreated(null);
    try {
      const invitation = await invitationsApi.create(projectId, email.trim(), role);
      setCreated(invitation);
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiClientError || err instanceof Error ? err.message : "Could not send that invitation.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Invite to ${projectName}`} description="Send an invitation link. The person joins only after they accept it.">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Invite by email</Label>
          <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="EDITOR">Editor — can edit files</option>
            <option value="VIEWER">Viewer — read-only</option>
          </select>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>
        )}
        {created && (
          <div role="status" className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950">
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              Invitation sent to {created.email} as {created.role}. They will appear as a member once they accept.
              {!created.invitedUserExists && " They don't have a CollabCode account yet — the link works after they sign up with this email."}
            </p>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Development mode — email delivery not configured. Share this link directly:</p>
            <div className="flex gap-2">
              <Input readOnly value={created.inviteUrl} aria-label="Invitation link" className="bg-white dark:bg-zinc-900" />
              <Button type="button" variant="secondary" onClick={() => void copyLink()} aria-label="Copy invitation link">
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Expires {new Date(created.expiresAt).toLocaleString()}.</p>
          </div>
        )}
        <Button type="submit" disabled={sending} className="w-full">
          {sending ? "Sending…" : "Send invitation"}
        </Button>
      </form>
    </Modal>
  );
}
