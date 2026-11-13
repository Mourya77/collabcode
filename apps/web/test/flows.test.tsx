import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";
import { ApiClientError } from "../src/lib/api/client";
import { authApi } from "../src/lib/api/auth";
import { projectsApi } from "../src/lib/api/projects";
import { filesApi } from "../src/lib/api/files";
import type { ApiFile, ApiMember, ApiProject, ApiUser } from "../src/lib/api/types";
import { useAuthStore } from "../src/stores/authStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useProjectStore } from "../src/stores/projectStore";
import { useUiStore } from "../src/stores/uiStore";
import { useWorkspaceStore } from "../src/stores/workspaceStore";
import { useCollabStore } from "../src/stores/collabStore";
import { useChatStore } from "../src/stores/chatStore";

/**
 * Flow tests run the real UI against a mocked API layer (src/lib/api/*).
 * The fake backend below mimics the Phase 2 API contract: cookie-session auth,
 * member-only projects, seeded starter files and version saves.
 */

const backend = vi.hoisted(() => {
  const user: ApiUser = {
    id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const state = {
    authenticated: true,
    projects: [] as ApiProject[],
    files: new Map<string, ApiFile[]>(),
    contents: new Map<string, string>(),
    saveCalls: [] as { fileId: string; content: string }[],
    seq: 0,
  };
  const now = () => new Date().toISOString();
  function seedFiles(project: ApiProject) {
    const folder: ApiFile = {
      id: `${project.id}-src`, projectId: project.id, parentId: null, name: "src",
      path: "src", type: "FOLDER", createdAt: now(), updatedAt: now(),
    };
    const welcome: ApiFile = {
      id: `${project.id}-welcome`, projectId: project.id, parentId: null, name: "welcome.md",
      path: "welcome.md", type: "FILE", createdAt: now(), updatedAt: now(),
    };
    const main: ApiFile = {
      id: `${project.id}-main`, projectId: project.id, parentId: folder.id, name: "main.ts",
      path: "src/main.ts", type: "FILE", createdAt: now(), updatedAt: now(),
    };
    state.files.set(project.id, [folder, welcome, main]);
    state.contents.set(welcome.id, "# Welcome to CollabCode\n");
    state.contents.set(main.id, "console.log('hello');\n");
  }
  function makeProject(name: string, role: ApiProject["role"] = "OWNER"): ApiProject {
    const project: ApiProject = {
      id: `proj-${++state.seq}`, name, description: null, ownerId: user.id, role,
      fileCount: 3, createdAt: now(), updatedAt: now(),
    };
    state.projects.unshift(project);
    seedFiles(project);
    return project;
  }
  function reset() {
    state.authenticated = true;
    state.projects = [];
    state.files = new Map();
    state.contents = new Map();
    state.saveCalls = [];
    state.seq = 0;
  }
  return { user, state, makeProject, reset };
});


// Monaco cannot run in jsdom. This stub provides the minimal editor/model
// surface CodeEditor uses: onMount delivers a fake editor whose model holds
// text; in collaborative mode (no `value` prop) the textarea is driven by
// the model, which the y-monaco test double below syncs with the Y.Text.
vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  function FakeMonacoEditor(props: {
    value?: string;
    onChange?: (v: string) => void;
    onMount?: (editor: unknown) => void;
    options?: { readOnly?: boolean };
  }) {
    const [display, setDisplay] = React.useState("");
    const rigRef = React.useRef<{
      model: {
        getValue: () => string;
        setValue: (v: string) => void;
        onDidChangeContent: (cb: () => void) => { dispose: () => void };
        _subscribe: (cb: () => void) => () => void;
      };
      editor: unknown;
    } | null>(null);
    if (!rigRef.current) {
      const listeners = new Set<() => void>();
      let text = "";
      const model = {
        getValue: () => text,
        setValue: (v: string) => {
          if (v !== text) {
            text = v;
            listeners.forEach((cb) => cb());
          }
        },
        onDidChangeContent: (cb: () => void) => {
          listeners.add(cb);
          return { dispose: () => { listeners.delete(cb); } };
        },
        _subscribe: (cb: () => void) => {
          listeners.add(cb);
          return () => { listeners.delete(cb); };
        },
      };
      rigRef.current = {
        model,
        editor: { getModel: () => model, getAction: () => null, updateOptions: () => undefined },
      };
    }
    const rig = rigRef.current;
    React.useEffect(() => {
      const unsub = rig.model._subscribe(() => setDisplay(rig.model.getValue()));
      setDisplay(rig.model.getValue());
      return unsub;
    }, [rig]);
    React.useEffect(() => {
      props.onMount?.(rig.editor as never);
      // (mock editor mount effect intentionally runs once)
    }, []);
    const bound = props.value === undefined;
    return (
      <textarea
        aria-label="Code editor"
        value={bound ? display : (props.value ?? "")}
        readOnly={props.options?.readOnly ?? false}
        onChange={(e) => {
          if (bound) rig.model.setValue(e.target.value);
          else props.onChange?.(e.target.value);
        }}
      />
    );
  }
  return { default: FakeMonacoEditor };
});

// Test double for y-monaco: whole-text sync between the model and the
// Y.Text (the real binding syncs deltas; for UI flows the net text effect
// is identical). Labelled as a double — CRDT behaviour itself is covered
// by the collaboration server test suite.
vi.mock("y-monaco", () => {
  class FakeMonacoBinding {
    private ytext: { toString(): string; observe(cb: () => void): void; unobserve(cb: () => void): void; doc: { transact(fn: () => void): void } | null; delete(i: number, n: number): void; insert(i: number, s: string): void; length: number };
    private model: { getValue(): string; setValue(v: string): void; onDidChangeContent(cb: () => void): { dispose(): void } };
    private yObs: () => void;
    private mSub: { dispose(): void };
    private applying = false;
    constructor(ytext: never, model: never) {
      this.ytext = ytext;
      this.model = model;
      this.model.setValue(this.ytext.toString());
      this.yObs = () => {
        if (this.applying) return;
        const t = this.ytext.toString();
        if (this.model.getValue() !== t) this.model.setValue(t);
      };
      this.ytext.observe(this.yObs);
      this.mSub = this.model.onDidChangeContent(() => {
        const t = this.model.getValue();
        if (t === this.ytext.toString()) return;
        this.applying = true;
        this.ytext.doc?.transact(() => {
          this.ytext.delete(0, this.ytext.length);
          if (t) this.ytext.insert(0, t);
        });
        this.applying = false;
      });
    }
    destroy() {
      this.ytext.unobserve(this.yObs);
      this.mSub.dispose();
    }
  }
  return { MonacoBinding: FakeMonacoBinding };
});

// Fake collaboration sessions: a real Y.Doc per file, seeded from the fake
// backend's stored content (mirroring how the real server seeds from the
// latest DocumentVersion), immediately "connected + synced".
vi.mock("../src/lib/collab/provider", async () => {
  const Y = await import("yjs");
  const { Awareness } = await import("y-protocols/awareness");
  return {
    createCollabSession: (
      args: { projectId: string; fileId: string; user: { id: string; name: string } },
      callbacks: {
        onStatus?: (s: string) => void;
        onSynced?: (b: boolean) => void;
      } = {},
    ) => {
      const doc = new Y.Doc();
      const yText = doc.getText("content");
      const initial = backend.state.contents.get(args.fileId);
      if (initial) yText.insert(0, initial);
      const awareness = new Awareness(doc);
      awareness.setLocalStateField("user", { id: args.user.id, name: args.user.name, color: "#3b82f6" });
      queueMicrotask(() => {
        callbacks.onStatus?.("connected");
        callbacks.onSynced?.(true);
      });
      return {
        key: `${args.projectId}:${args.fileId}`,
        projectId: args.projectId,
        fileId: args.fileId,
        documentName: `project:${args.projectId}:file:${args.fileId}`,
        doc,
        yText,
        provider: { destroy: () => undefined },
        awareness,
        dispose: () => {
          awareness.setLocalState(null);
          doc.destroy();
        },
      };
    },
  };
});

vi.mock("../src/lib/api/auth", () => ({
  authApi: {
    me: vi.fn(async () => {
      if (!backend.state.authenticated) throw new ApiClientError(401, "UNAUTHORIZED", "Authentication required");
      return backend.user;
    }),
    login: vi.fn(async () => {
      backend.state.authenticated = true;
      return backend.user;
    }),
    register: vi.fn(async () => {
      backend.state.authenticated = true;
      return backend.user;
    }),
    logout: vi.fn(async () => {
      backend.state.authenticated = false;
    }),
    updateMe: vi.fn(async (patch: { name?: string; avatarUrl?: string | null }) => ({ ...backend.user, ...patch })),
  },
}));

vi.mock("../src/lib/api/projects", () => ({
  projectsApi: {
    list: vi.fn(async (params?: { search?: string; limit?: number }) => {
      const q = params?.search?.toLowerCase();
      const items = backend.state.projects.filter((p) => !q || p.name.toLowerCase().includes(q));
      return { items, total: items.length, page: 1, limit: params?.limit ?? 50 };
    }),
    create: vi.fn(async (name: string, description?: string) => {
      const p = backend.makeProject(name);
      return { ...p, description: description ?? null };
    }),
    get: vi.fn(async (id: string) => {
      const p = backend.state.projects.find((x) => x.id === id);
      if (!p) throw new ApiClientError(404, "NOT_FOUND", "Project not found");
      return p;
    }),
    remove: vi.fn(async (id: string) => {
      backend.state.projects = backend.state.projects.filter((x) => x.id !== id);
    }),
    listMembers: vi.fn(async (): Promise<ApiMember[]> => [
      { userId: backend.user.id, role: "OWNER", joinedAt: "2026-01-01T00:00:00.000Z", user: { name: backend.user.name, email: backend.user.email, avatarUrl: null } },
    ]),
    updateMemberRole: vi.fn(async (_projectId: string, userId: string, role: "EDITOR" | "VIEWER") => ({
      userId, role, joinedAt: "2026-01-02T00:00:00.000Z",
      user: { name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
    })),
    removeMember: vi.fn(async () => ({ removed: true })),
  },
}));

// Phase 4 modules: invitations v2 + chat REST. The chat WebSocket client is
// NOT mocked here — jsdom cannot reach a server, so the client just stays in
// its reconnecting state and the (unopened) chat tab is inert.
vi.mock("../src/lib/api/invitations", () => ({
  invitationsApi: {
    create: vi.fn(async (_projectId: string, email: string, role: "EDITOR" | "VIEWER") => {
      if (email === "taken@example.com") {
        throw new ApiClientError(409, "DUPLICATE_INVITATION", "A pending invitation for that email already exists for this project.");
      }
      return {
        id: "inv-1", projectId: _projectId, email, role, status: "PENDING" as const,
        invitedById: backend.user.id, expiresAt: "2026-01-08T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        inviteUrl: `http://localhost:5173/invite/${"a".repeat(64)}`,
        invitedUserExists: email !== "ghost@example.com",
      };
    }),
    list: vi.fn(async () => []),
    revoke: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
    preview: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
    mine: vi.fn(async () => []),
    accept: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
    decline: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
    acceptById: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
    declineById: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
  },
}));

vi.mock("../src/lib/api/chat", () => ({
  chatApi: {
    listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
    presence: vi.fn(async () => ({ online: [], members: [] })),
  },
}));

vi.mock("../src/lib/api/files", () => ({
  filesApi: {
    list: vi.fn(async (projectId: string) => backend.state.files.get(projectId) ?? []),
    get: vi.fn(async (fileId: string) => {
      for (const list of backend.state.files.values()) {
        const f = list.find((x) => x.id === fileId);
        if (f) return { ...f, content: backend.state.contents.get(fileId) ?? "" };
      }
      throw new ApiClientError(404, "NOT_FOUND", "File not found");
    }),
    create: vi.fn(async (projectId: string, body: { name: string; type: "FILE" | "FOLDER"; parentId?: string | null; content?: string }) => {
      const list = backend.state.files.get(projectId) ?? [];
      const parent = body.parentId ? list.find((x) => x.id === body.parentId) : null;
      const file: ApiFile = {
        id: `${projectId}-f${list.length + 1}`, projectId, parentId: body.parentId ?? null,
        name: body.name, path: parent ? `${parent.path}/${body.name}` : body.name,
        type: body.type, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      };
      list.push(file);
      backend.state.files.set(projectId, list);
      if (body.type === "FILE") backend.state.contents.set(file.id, body.content ?? "");
      return { ...file, content: body.type === "FILE" ? (body.content ?? "") : undefined };
    }),
    update: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
    remove: vi.fn(async (fileId: string) => {
      for (const [pid, list] of backend.state.files) {
        backend.state.files.set(pid, list.filter((x) => x.id !== fileId && x.parentId !== fileId));
      }
    }),
    listVersions: vi.fn(async () => []),
    getVersion: vi.fn(async () => {
      throw new Error("not used in flows");
    }),
    saveVersion: vi.fn(async (fileId: string, content: string) => {
      backend.state.saveCalls.push({ fileId, content });
      backend.state.contents.set(fileId, content);
      return { id: `v-${backend.state.saveCalls.length}`, fileId, versionNumber: backend.state.saveCalls.length, createdAt: "2026-01-01T00:00:00.000Z" };
    }),
  },
}));

function resetStores() {
  useAuthStore.setState({ user: null, bootstrapped: false, isLoading: false, error: null });
  useProjectStore.setState({
    projects: [], total: 0, isLoading: false, error: null, currentProject: null,
    files: [], tree: [], members: [], workspaceLoading: false, workspaceError: null, saveError: null,
  });
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useCollabStore.getState().stop();
  useChatStore.getState().disconnect();
  useChatStore.setState({
    messagesByProject: {}, nextCursorByProject: {}, historyLoadedByProject: {}, presenceByProject: {}, error: null,
  });
}

describe("CollabCode flows (mocked API)", () => {
  beforeEach(() => {
    localStorage.clear();
    backend.reset();
    resetStores();
    useUiStore.setState({ theme: "light" });
    window.history.pushState({}, "", "/");
  });

  it("landing shows sign-up CTAs and an honest API-offline status when logged out", async () => {
    backend.state.authenticated = false;
    render(<App />);
    expect(screen.getByRole("link", { name: "Create your account" })).toBeInTheDocument();
    expect(await screen.findByText(/API status: down/)).toBeInTheDocument();
  });

  it("redirects unauthenticated visitors from /dashboard to /login", async () => {
    backend.state.authenticated = false;
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
  });

  it("validates the login form before submitting", async () => {
    backend.state.authenticated = false;
    window.history.pushState({}, "", "/login");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("logs in through the API and lands on the dashboard", async () => {
    backend.state.authenticated = false;
    window.history.pushState({}, "", "/login");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText(/Welcome back, Ada/)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("dashboard shows the empty state when the API returns no projects", async () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("creates a project through the API and opens its workspace with the seeded welcome file", async () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Demo App" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/workspace\//));
    const editor = await screen.findByLabelText("Code editor");
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("# Welcome to CollabCode"));
  });

  it("dashboard search filters through the API search parameter", async () => {
    backend.makeProject("Alpha");
    backend.makeProject("Beta");
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "alp" } });
    await waitFor(() => expect(screen.queryByText("Beta")).not.toBeInTheDocument());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("expands folders in the explorer and loads file content from the API on open", async () => {
    const project = backend.makeProject("Explorer Demo");
    window.history.pushState({}, "", `/workspace/${project.id}`);
    render(<App />);
    // Root folders start expanded, so main.ts is listed right away.
    fireEvent.click(await screen.findByRole("button", { name: "Open file main.ts" }));
    const editor = await screen.findByLabelText("Code editor");
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("console.log('hello');"));
  });

  it("editing goes through the live Yjs document — collab mode never calls the REST save", async () => {
    const project = backend.makeProject("Live Edit");
    window.history.pushState({}, "", `/workspace/${project.id}`);
    render(<App />);
    const editor = (await screen.findByLabelText("Code editor")) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("# Welcome"));
    expect(await screen.findByTestId("collab-status")).toHaveTextContent(/Synced/);
    fireEvent.change(editor, { target: { value: "# Welcome\n// edited live\n" } });
    // The Y.Text mirror feeds editorStore (Problems panel etc.)…
    await waitFor(() =>
      expect(useEditorStore.getState().contents[`${project.id}-welcome`]).toContain("// edited live"),
    );
    // …and persistence is the collaboration server's job now: even after
    // longer than the old 800ms debounce, no REST saveVersion call happens.
    await new Promise((r) => setTimeout(r, 1200));
    expect(backend.state.saveCalls).toHaveLength(0);
  });

  it("a VIEWER gets a read-only editor with a view-only banner", async () => {
    const project = backend.makeProject("Shared Read Only", "VIEWER");
    window.history.pushState({}, "", `/workspace/${project.id}`);
    render(<App />);
    expect(await screen.findByText("View-only access")).toBeInTheDocument();
    const editor = (await screen.findByLabelText("Code editor")) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("# Welcome"));
    expect(editor.readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "New file" })).not.toBeInTheDocument();
  });

  it("invite v2: an unregistered email gets a pending invitation and the dev invite link is shown", async () => {
    const project = backend.makeProject("Team Space");
    window.history.pushState({}, "", `/workspace/${project.id}`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Invite/ }));
    fireEvent.change(await screen.findByLabelText("Invite by email"), { target: { value: "ghost@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Invitation sent to ghost@example\.com as EDITOR/);
    expect(screen.getByText(/don't have a CollabCode account yet/)).toBeInTheDocument();
    expect(screen.getByText(/Development mode — email delivery not configured/)).toBeInTheDocument();
    const link = screen.getByLabelText("Invitation link") as HTMLInputElement;
    expect(link.value).toContain("/invite/");
  });

  it("invite v2: a duplicate pending invitation surfaces the API 409 message", async () => {
    const project = backend.makeProject("Team Space");
    window.history.pushState({}, "", `/workspace/${project.id}`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Invite/ }));
    fireEvent.change(await screen.findByLabelText("Invite by email"), { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/pending invitation for that email already exists/);
  });

  it("settings theme choice persists to localStorage", async () => {
    window.history.pushState({}, "", "/settings");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "dark" }));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("collabcode.ui") ?? "{}").state?.theme).toBe("dark");
    });
  });

  // ---------- Phase 7: flow gaps (registration, error/loading states, file ops) ----------

  it("register: mismatched passwords are rejected client-side and the API is never called", async () => {
    backend.state.authenticated = false;
    const registerSpy = vi.mocked(authApi.register);
    registerSpy.mockClear();
    window.history.pushState({}, "", "/register");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it("register: a short password is rejected client-side", async () => {
    backend.state.authenticated = false;
    window.history.pushState({}, "", "/register");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
  });

  it("register: success creates the account and lands on the dashboard", async () => {
    backend.state.authenticated = false;
    window.history.pushState({}, "", "/register");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(/Welcome back, Ada/)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("register: an API conflict (duplicate email) is shown as an alert", async () => {
    backend.state.authenticated = false;
    vi.mocked(authApi.register).mockRejectedValueOnce(
      new ApiClientError(409, "CONFLICT", "An account with this email already exists."),
    );
    window.history.pushState({}, "", "/register");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/);
    expect(window.location.pathname).toBe("/register");
  });

  it("login: wrong credentials surface the API error and stay on the page", async () => {
    backend.state.authenticated = false;
    vi.mocked(authApi.login).mockRejectedValueOnce(
      new ApiClientError(401, "UNAUTHORIZED", "Invalid email or password."),
    );
    window.history.pushState({}, "", "/login");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Invalid email or password/);
    expect(window.location.pathname).toBe("/login");
  });

  it("dashboard: shows the loading state while projects are being fetched", async () => {
    let release!: (v: { items: ApiProject[]; total: number; page: number; limit: number }) => void;
    vi.mocked(projectsApi.list).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(await screen.findByText("Loading your projects…")).toBeInTheDocument();
    release({ items: [], total: 0, page: 1, limit: 50 });
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("dashboard: an API failure shows the error with a working Retry", async () => {
    vi.mocked(projectsApi.list).mockRejectedValueOnce(new ApiClientError(500, "INTERNAL", "Internal server error"));
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(await screen.findByText("Internal server error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("create project: an empty name is rejected inside the dialog", async () => {
    const createSpy = vi.mocked(projectsApi.create);
    createSpy.mockClear();
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    // Two "Create project" buttons exist (page + dialog); the click above
    // targets the dialog's submit via the last match.
    expect(await screen.findByText("Project name is required.")).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("create project: an API failure is surfaced inside the dialog", async () => {
    vi.mocked(projectsApi.create).mockRejectedValueOnce(new ApiClientError(500, "INTERNAL", "Internal server error"));
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Doomed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Internal server error/);
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("workspace: switching files in the explorer swaps the editor content", async () => {
    const project = backend.makeProject("Switcher");
    window.history.pushState({}, "", `/workspace/${project.id}`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open file welcome.md" }));
    const editor = await screen.findByLabelText("Code editor");
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("# Welcome to CollabCode"));
    fireEvent.click(screen.getByRole("button", { name: "Open file main.ts" }));
    // The editor remounts per file (key = file id), so re-query it here —
    // a reference captured before the switch points at the unmounted node.
    await waitFor(
      () => expect((screen.getByLabelText("Code editor") as HTMLTextAreaElement).value).toContain("console.log('hello');"),
      { timeout: 5000 },
    );
    expect(useEditorStore.getState().activeFileId).toBe(`${project.id}-main`);
  });

  it("workspace: creating a file from the explorer adds it and opens it", async () => {
    const project = backend.makeProject("Creator");
    const createSpy = vi.mocked(filesApi.create);
    createSpy.mockClear();
    window.history.pushState({}, "", `/workspace/${project.id}`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "New file" }));
    const input = await screen.findByLabelText("New file name");
    fireEvent.change(input, { target: { value: "notes.txt" } });
    fireEvent.submit(input.closest("form") as HTMLElement);
    expect(await screen.findByRole("button", { name: "Open file notes.txt" })).toBeInTheDocument();
    expect(createSpy).toHaveBeenCalledWith(project.id, expect.objectContaining({ name: "notes.txt", type: "FILE" }));
    const created = (backend.state.files.get(project.id) ?? []).find((f) => f.name === "notes.txt");
    expect(created).toBeTruthy();
    expect(useEditorStore.getState().openTabs).toContain(created!.id);
    expect(useEditorStore.getState().activeFileId).toBe(created!.id);
  });

  it("settings: saving the profile calls the API and shows the Saved confirmation", async () => {
    const updateSpy = vi.mocked(authApi.updateMe);
    updateSpy.mockClear();
    window.history.pushState({}, "", "/settings");
    render(<App />);
    const nameInput = await screen.findByLabelText("Display name");
    fireEvent.change(nameInput, { target: { value: "Ada Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Updated" }));
  });
});
