import { useEffect, useState } from "react";
import { Code2 } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { Button, buttonVariants } from "../components/ui/button";
import { invitationsApi } from "../lib/api/invitations";
import { ApiClientError } from "../lib/api/client";
import type { ApiInvitationPreview } from "../lib/api/types";
import { useAuthStore } from "../stores/authStore";

/**
 * Public invitation landing page (Phase 4): /invite/:token.
 * Shows a minimal preview (project, inviter, role — no private data). The
 * token only works for the invited email: accepting while signed in with a
 * different account surfaces the API's INVITATION_EMAIL_MISMATCH error.
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const user = useAuthStore((s) => s.user);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const location = useLocation();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<ApiInvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    invitationsApi
      .preview(token)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof ApiClientError || e instanceof Error ? e.message : "This invitation link is invalid.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function act(kind: "accept" | "decline") {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "accept") {
        const { project } = await invitationsApi.accept(token);
        setSettled("accepted");
        navigate(`/workspace/${project.id}`, { replace: true });
      } else {
        await invitationsApi.decline(token);
        setSettled("declined");
        navigate("/dashboard", { replace: true });
      }
    } catch (e) {
      setActionError(e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const card = (
    <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center gap-2">
        <Code2 className="h-5 w-5 text-sky-500" aria-hidden />
        <span className="text-sm font-semibold">CollabCode invitation</span>
      </div>
      {loadError ? (
        <>
          <h1 className="text-lg font-semibold">Invitation not found</h1>
          <p role="alert" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{loadError}</p>
          <Link to={user ? "/dashboard" : "/"} className={buttonVariants({ className: "mt-5" })}>
            {user ? "Go to dashboard" : "Go to home"}
          </Link>
        </>
      ) : !preview ? (
        <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">Loading invitation…</p>
      ) : (
        <>
          <h1 className="text-lg font-semibold">You&apos;re invited to “{preview.projectName}”</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {preview.inviterName} invited you to join as <strong className="text-zinc-700 dark:text-zinc-200">{preview.role}</strong>.
            {preview.status === "PENDING" && <> This invitation expires {new Date(preview.expiresAt).toLocaleString()}.</>}
          </p>
          {preview.status !== "PENDING" && (
            <p role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              This invitation is {preview.status.toLowerCase()} and can no longer be used. Ask {preview.inviterName} for a new one.
            </p>
          )}
          {actionError && (
            <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{actionError}</p>
          )}
          {preview.status === "PENDING" &&
            (settled ? (
              <p role="status" className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">Done — redirecting…</p>
            ) : !bootstrapped ? (
              <p role="status" className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Restoring your session…</p>
            ) : user ? (
              <>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Signed in as {user.email}. The invitation only works for the email it was sent to.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => void act("accept")} disabled={busy}>{busy ? "Working…" : "Accept invitation"}</Button>
                  <Button variant="outline" onClick={() => void act("decline")} disabled={busy}>Decline</Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                  Log in or create an account with the email this invitation was sent to — you&apos;ll come right back here.
                </p>
                <div className="mt-4 flex gap-2">
                  <Link to="/login" state={{ from: location.pathname }} className={buttonVariants()}>Log in</Link>
                  <Link to="/register" state={{ from: location.pathname }} className={buttonVariants({ variant: "outline" })}>Create account</Link>
                </div>
              </>
            ))}
        </>
      )}
    </div>
  );

  if (user) {
    return (
      <AppLayout title="Invitation">
        <div className="flex justify-center px-6 py-10">{card}</div>
      </AppLayout>
    );
  }
  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">{card}</main>;
}
