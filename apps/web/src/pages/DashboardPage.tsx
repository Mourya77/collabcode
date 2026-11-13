import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, LayoutGrid, Mail, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { ProjectCard } from "../components/ProjectCard";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { invitationsApi } from "../lib/api/invitations";
import { ApiClientError } from "../lib/api/client";
import type { ApiMyInvitation } from "../lib/api/types";
import { useAuthStore } from "../stores/authStore";
import { useProjectStore } from "../stores/projectStore";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const projects = useProjectStore((s) => s.projects);
  const total = useProjectStore((s) => s.total);
  const isLoading = useProjectStore((s) => s.isLoading);
  const error = useProjectStore((s) => s.error);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  // Phase 4: pending invitations addressed to the signed-in user's email.
  const [myInvitations, setMyInvitations] = useState<ApiMyInvitation[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);

  const loadMyInvitations = useCallback(async () => {
    try {
      setMyInvitations(await invitationsApi.mine());
    } catch {
      // Auxiliary section — failing to load it must not break the dashboard.
      setMyInvitations([]);
    }
  }, []);

  useEffect(() => {
    void loadMyInvitations();
  }, [loadMyInvitations]);

  async function respondToInvitation(inv: ApiMyInvitation, kind: "accept" | "decline") {
    setInviteBusy(inv.id);
    setInviteError(null);
    try {
      if (kind === "accept") {
        const { project } = await invitationsApi.acceptById(inv.id);
        navigate(`/workspace/${project.id}`);
      } else {
        await invitationsApi.declineById(inv.id);
        await loadMyInvitations();
      }
    } catch (e) {
      setInviteError(e instanceof ApiClientError || e instanceof Error ? e.message : "Could not respond to that invitation.");
      await loadMyInvitations();
    } finally {
      setInviteBusy(null);
    }
  }

  // Initial load + debounced server-side search.
  useEffect(() => {
    const t = setTimeout(() => {
      void fetchProjects(query);
    }, 250);
    return () => clearTimeout(t);
  }, [query, fetchProjects]);

  const firstName = useMemo(() => user?.name.trim().split(/\s+/)[0] ?? "there", [user]);

  return (
    <AppLayout title="Dashboard">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Pick a project to keep building, or start something new.</p>
          </div>
          <Button onClick={() => setModalOpen(true)}>
            <FolderPlus className="h-4 w-4" aria-hidden /> Create project
          </Button>
        </div>

        {myInvitations.length > 0 && (
          <section aria-label="Invitations for you" className="mt-6 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-100">
              <Mail className="h-4 w-4" aria-hidden /> Invitations for you
            </h3>
            {inviteError && (
              <p role="alert" className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{inviteError}</p>
            )}
            <ul className="mt-2 space-y-2">
              {myInvitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-md bg-white px-3 py-2 dark:bg-zinc-900">
                  <span className="min-w-0 flex-1 text-sm">
                    <strong>{inv.inviterName}</strong> invited you to <strong>{inv.projectName}</strong> as {inv.role}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">Expires {new Date(inv.expiresAt).toLocaleString()}</span>
                  </span>
                  <Button size="sm" disabled={inviteBusy === inv.id} onClick={() => void respondToInvitation(inv, "accept")}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" disabled={inviteBusy === inv.id} onClick={() => void respondToInvitation(inv, "decline")}>
                    Decline
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="relative mt-6 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {error && (
          <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void fetchProjects(query)}>Retry</Button>
          </div>
        )}

        {isLoading && projects.length === 0 ? (
          <p role="status" className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">Loading your projects…</p>
        ) : total === 0 && !query.trim() ? (
          <div className="mt-10 flex flex-col items-center rounded-lg border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
            <LayoutGrid className="h-8 w-8 text-zinc-400" aria-hidden />
            <h3 className="mt-4 text-base font-semibold">No projects yet</h3>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Create your first project to open a workspace with a starter file tree and a working editor.
            </p>
            <Button className="mt-5" onClick={() => setModalOpen(true)}>
              <FolderPlus className="h-4 w-4" aria-hidden /> Create your first project
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">No projects match “{query}”.</p>
        ) : (
          <section aria-label="Recent projects" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} {...(p.role === "OWNER" ? { onDelete: deleteProject } : {})} />
            ))}
          </section>
        )}
      </div>
      <CreateProjectModal open={modalOpen} onOpenChange={setModalOpen} />
    </AppLayout>
  );
}
