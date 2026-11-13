import { useEffect, useState } from "react";
import { Code2, Files, GitBranch, History, PanelRight, Play, Search, Settings as SettingsIcon, Square, UserPlus, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { BottomPanel } from "../components/BottomPanel";
import { ChatPanel } from "../components/ChatPanel";
import { CodeEditor } from "../components/CodeEditor";
import { CollaboratorAvatars, initialsOf } from "../components/CollaboratorAvatars";
import { EditorTabs } from "../components/EditorTabs";
import { FileExplorer } from "../components/FileExplorer";
import { InviteModal } from "../components/InviteModal";
import { MembersModal } from "../components/MembersModal";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";
import { UserMenu } from "../components/UserMenu";
import { WorkspacePresence } from "../components/WorkspacePresence";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { findNode, flattenFiles } from "../types";
import { useAuthStore } from "../stores/authStore";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";
import { useExecutionStore } from "../stores/executionStore";
import { useWorkspaceStore, type ActivityPanel } from "../stores/workspaceStore";
import { collabStatusLabel, saveStateLabel, useCollabStore } from "../stores/collabStore";
import { useChatStore } from "../stores/chatStore";
import { buildRemoteSelectionCss } from "../lib/collab/cursorStyles";
import { cn } from "../lib/utils";

const ACTIVITY: { id: ActivityPanel; label: string; icon: typeof Files }[] = [
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search files", icon: Search },
  { id: "scm", label: "Source control", icon: GitBranch },
];

type LoadState = "loading" | "ready" | "error";

export default function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const user = useAuthStore((s) => s.user);
  const project = useProjectStore((s) => s.currentProject);
  const tree = useProjectStore((s) => s.tree);
  const files = useProjectStore((s) => s.files);
  const members = useProjectStore((s) => s.members);
  const workspaceError = useProjectStore((s) => s.workspaceError);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const collabSession = useCollabStore((s) => s.session);
  const collabStatus = useCollabStore((s) => s.status);
  const collabSynced = useCollabStore((s) => s.synced);
  const collabAuthError = useCollabStore((s) => s.authError);
  const saveState = useCollabStore((s) => s.saveState);
  const savedAt = useCollabStore((s) => s.savedAt);
  const liveUsers = useCollabStore((s) => s.liveUsers);
  const activity = useWorkspaceStore((s) => s.activity);
  const setActivity = useWorkspaceStore((s) => s.setActivity);
  const searchQuery = useWorkspaceStore((s) => s.searchQuery);
  const setSearchQuery = useWorkspaceStore((s) => s.setSearchQuery);
  const rightTab = useWorkspaceStore((s) => s.rightTab);
  const setRightTab = useWorkspaceStore((s) => s.setRightTab);
  const setBottomTab = useWorkspaceStore((s) => s.setBottomTab);
  const execPhase = useExecutionStore((s) => s.phase);
  const execStartedAt = useExecutionStore((s) => s.startedAt);
  const [, setExecTick] = useState(0);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUiStore((s) => s.setRightPanelOpen);
  const setBottomPanelCollapsed = useUiStore((s) => s.setBottomPanelCollapsed);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const readOnly = project?.role === "VIEWER";

  // Load project + files from the API, then prime the editor store.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoadState("loading");
    useWorkspaceStore.getState().resetWorkspaceUi();
    useExecutionStore.getState().clear();
    useEditorStore.getState().reset();
    void (async () => {
      const ok = await useProjectStore.getState().loadWorkspace(projectId);
      if (cancelled) return;
      if (!ok) {
        setLoadState("error");
        return;
      }
      const loadedTree = useProjectStore.getState().tree;
      const flat = flattenFiles(loadedTree);
      const first = flat.find((f) => f.name === "welcome.md") ?? flat[0] ?? null;
      useEditorStore.getState().loadProject(projectId, {}, first?.id ?? null);
      useWorkspaceStore.getState().setExpanded(loadedTree.filter((n) => n.type === "folder").map((n) => n.id));
      setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Phase 3: the active file is edited through a live Yjs session. The
  // session (re)starts whenever the active file changes; starting a new one
  // disposes the previous session completely (binding, provider, document).
  const activeFileNode = activeFileId ? findNode(tree, activeFileId) : undefined;
  const activeNodeId = activeFileNode?.id;
  const activeNodeType = activeFileNode?.type;
  useEffect(() => {
    if (loadState !== "ready" || !projectId || !user || !activeNodeId || activeNodeType !== "file") return;
    useCollabStore.getState().start({
      projectId,
      fileId: activeNodeId,
      user: { id: user.id, name: user.name },
    });
  }, [loadState, projectId, activeNodeId, activeNodeType, user]);

  // Leaving the workspace tears the session down.
  useEffect(() => {
    return () => {
      useCollabStore.getState().stop();
    };
  }, []);

  // Phase 4: the chat connection + workspace presence live for the whole
  // workspace session (independent of which file/document is open).
  useEffect(() => {
    if (loadState !== "ready" || !projectId) return;
    useChatStore.getState().connect(projectId);
    return () => {
      useChatStore.getState().disconnect();
    };
  }, [loadState, projectId]);

  // Phase 4: announce the active file to workspace presence on change.
  useEffect(() => {
    if (loadState !== "ready" || !projectId) return;
    useChatStore.getState().setActiveFile(projectId, activeFileId);
  }, [loadState, projectId, activeFileId]);

  // Phase 5: tick while a run is in flight so the header shows elapsed time.
  useEffect(() => {
    if (execPhase !== "running") return;
    const t = setInterval(() => setExecTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [execPhase]);

  if (loadState === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">Loading workspace…</p>
      </main>
    );
  }

  if (loadState === "error" || !project) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 text-center dark:bg-zinc-950">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Workspace not available</h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          {workspaceError ?? "This project could not be loaded. It may have been deleted, or you are not a member."}
        </p>
        <Link to="/dashboard" className={buttonVariants({ className: "mt-6" })}>Back to dashboard</Link>
      </main>
    );
  }

  const execElapsedSec = execStartedAt ? Math.max(0, Math.floor((Date.now() - execStartedAt) / 1000)) : 0;

  if (!user) return null;
  const activeFile = activeFileId ? findNode(tree, activeFileId) : undefined;

  // Phase 5: run the active file in the isolated execution service. The
  // whole project file set is submitted; files open in the editor carry
  // their live (Yjs) content, the rest run their latest saved version.
  function handleRun() {
    if (!projectId || !activeFile || activeFile.type !== "file" || readOnly) return;
    setBottomTab("output");
    setBottomPanelCollapsed(false);
    const contents = useEditorStore.getState().contents;
    const payload = files
      .filter((f) => f.type === "FILE")
      .map((f) => ({ fileId: f.id, ...(contents[f.id] !== undefined ? { content: contents[f.id] } : {}) }));
    void useExecutionStore.getState().run({
      projectId,
      entryFileId: activeFile.id,
      entryFileName: activeFile.name,
      files: payload,
    });
  }

  function handleCancelRun() {
    useExecutionStore.getState().cancel();
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {liveUsers.length > 1 && <style>{buildRemoteSelectionCss(liveUsers)}</style>}
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <Link to="/dashboard" aria-label="Back to dashboard" className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
          <Code2 className="h-5 w-5 text-sky-500" aria-hidden />
          <span className="hidden text-sm font-semibold tracking-tight sm:block">CollabCode</span>
        </Link>
        <span aria-hidden className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <h1 className="min-w-0 truncate text-sm font-medium">{project.name}</h1>
        <span className="hidden shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {project.role}
        </span>
        {readOnly && (
          <span data-testid="readonly-banner" className="hidden shrink-0 text-xs text-amber-600 md:block dark:text-amber-400" role="status">
            View-only access
          </span>
        )}
        <span data-testid="collab-status" className="hidden shrink-0 items-center gap-1.5 text-xs text-zinc-500 md:flex dark:text-zinc-400" role="status">
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              collabStatus === "connected" && collabSynced ? "bg-emerald-500" : collabStatus === "connected" || collabStatus === "connecting" || collabStatus === "reconnecting" ? "bg-amber-500" : "bg-red-500",
            )}
          />
          {collabStatusLabel(collabStatus, collabSynced)}
        </span>
        {collabSession && saveStateLabel(saveState, savedAt) && (
          <span data-testid="save-status" className="hidden shrink-0 items-center gap-1.5 text-xs text-zinc-500 lg:flex dark:text-zinc-400" role="status">
            <span
              aria-hidden
              className={cn(
                "h-2 w-2 rounded-full",
                saveState === "saved" ? "bg-emerald-500" : saveState === "failed" ? "bg-red-500" : "bg-amber-500",
              )}
            />
            {saveStateLabel(saveState, savedAt)}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <CollaboratorAvatars members={members} currentUserId={user.id} liveUsers={liveUsers} />
          <Button size="sm" variant="outline" onClick={() => setMembersOpen(true)}>
            <Users className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Members</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setHistoryOpen(true)}
            disabled={!activeFile || activeFile.type !== "file"}
            title={activeFile && activeFile.type === "file" ? `Version history for ${activeFile.name}` : "Open a file to see its history"}
          >
            <History className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">History</span>
          </Button>
          {project.role === "OWNER" && (
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Invite</span>
            </Button>
          )}
          {execPhase === "running" ? (
            <>
              <span data-testid="run-status" role="status" className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                Running… {execElapsedSec}s
              </span>
              <Button size="sm" variant="danger" onClick={handleCancelRun}>
                <Square className="h-4 w-4" aria-hidden /> Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleRun}
              disabled={readOnly || !activeFile || activeFile.type !== "file"}
              title={readOnly ? "View-only — running code requires an Editor role" : activeFile ? `Run ${activeFile.name}` : "Open a file to run it"}
            >
              <Play className="h-4 w-4" aria-hidden /> Run
            </Button>
          )}
          <button
            type="button"
            aria-label={rightPanelOpen ? "Hide collaboration panel" : "Show collaboration panel"}
            aria-pressed={rightPanelOpen}
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={cn("rounded p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500", rightPanelOpen ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800")}
          >
            <PanelRight className="h-4 w-4" aria-hidden />
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav aria-label="Workspace views" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-zinc-50 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          {ACTIVITY.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={activity === id}
              title={label}
              onClick={() => setActivity(id)}
              className={cn(
                "rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
                activity === id ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </button>
          ))}
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className="mt-auto rounded-md p-2 text-zinc-500 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <SettingsIcon className="h-5 w-5" aria-hidden />
          </Link>
        </nav>

        {/* Left sidebar panel */}
        <aside aria-label="Explorer panel" className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 sm:flex">
          {activity === "explorer" && (
            <>
              <h2 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Explorer</h2>
              <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                <FileExplorer tree={tree} readOnly={readOnly} />
              </div>
            </>
          )}
          {activity === "search" && (
            <>
              <h2 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Search files</h2>
              <div className="px-2 py-1">
                <Input aria-label="Search files by name" placeholder="Search files…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                <FileExplorer tree={tree} readOnly={readOnly} />
              </div>
            </>
          )}
          {activity === "scm" && (
            <div className="px-3 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Source control</h2>
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                Source control arrives with Git integration. In the meantime your files live on the server, and every save creates a document version.
              </p>
            </div>
          )}
        </aside>

        {/* Editor column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorTabs tree={tree} />
          {activeFile && activeFile.type === "file" ? (
            <CodeEditor key={activeFile.id} file={activeFile} readOnly={readOnly} session={collabSession} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <Code2 className="h-8 w-8 text-zinc-300 dark:text-zinc-700" aria-hidden />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Select a file from the explorer to start editing.</p>
            </div>
          )}
          <BottomPanel tree={tree} />
        </div>

        {/* Right panel */}
        {rightPanelOpen && (
          <aside aria-label="Collaboration panel" className="hidden w-72 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:flex">
            <div role="tablist" aria-label="Collaboration" className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800">
              {(["collaboration", "chat"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={rightTab === t}
                  onClick={() => setRightTab(t)}
                  className={cn(
                    "flex-1 px-3 py-2 text-xs font-medium uppercase tracking-wide focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500",
                    rightTab === t ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  {t === "collaboration" ? "Collaboration" : "Chat"}
                </button>
              ))}
            </div>
            {rightTab === "collaboration" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {collabAuthError && (
                  <p role="alert" className="mb-3 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                    Collaboration sign-in failed ({collabAuthError}). The editor keeps your changes locally and retries with a fresh token.
                  </p>
                )}
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Live now</h3>
                {liveUsers.length > 0 ? (
                  <ul className="mt-2 space-y-1" aria-label="Live users">
                    {liveUsers.map((u) => (
                      <li key={u.clientId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: u.color }} />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {u.name} {u.isSelf && <span className="text-zinc-400">(you)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No live session yet — open a file to start collaborating.</p>
                )}
                <div className="mt-4">
                  <WorkspacePresence projectId={project.id} members={members} files={files} currentUserId={user.id} />
                </div>
                <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Project members</h3>
                <ul className="mt-2 space-y-1">
                  {members.map((m) => {
                    const live = liveUsers.some((u) => u.userId === m.userId);
                    return (
                      <li key={m.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[11px] font-semibold text-white">
                          {initialsOf(m.user.name)}
                          {live && <span aria-label="live now" className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.user.name} {m.userId === user.id && <span className="text-zinc-400">(you)</span>}</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{m.user.email}</span>
                        </span>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{m.role}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  Files are edited live through the collaboration server (Yjs CRDTs): everyone sees the same document, remote cursors are coloured per user, and the server saves document versions automatically — there is no manual save.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1">
                <ChatPanel projectId={project.id} />
              </div>
            )}
          </aside>
        )}
      </div>

      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} projectName={project.name} />
      <MembersModal open={membersOpen} onOpenChange={setMembersOpen} projectName={project.name} />
      {activeFile && activeFile.type === "file" && (
        <VersionHistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          fileId={activeFile.id}
          fileName={activeFile.name}
          canEdit={!readOnly}
          getCurrentContent={() =>
            collabSession && collabSession.fileId === activeFile.id
              ? collabSession.yText.toString()
              : (useEditorStore.getState().contents[activeFile.id] ?? "")
          }
        />
      )}
    </div>
  );
}
