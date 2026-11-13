import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { OutputPanel } from "../src/components/OutputPanel";
import WorkspacePage from "../src/pages/WorkspacePage";
import { ApiClientError } from "../src/lib/api/client";
import type { ApiExecution, ApiFile, ApiProject, ApiUser } from "../src/lib/api/types";
import { useAuthStore } from "../src/stores/authStore";
import { useChatStore } from "../src/stores/chatStore";
import { useCollabStore } from "../src/stores/collabStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useExecutionStore } from "../src/stores/executionStore";
import { useProjectStore } from "../src/stores/projectStore";
import { useUiStore } from "../src/stores/uiStore";
import { useWorkspaceStore } from "../src/stores/workspaceStore";

/**
 * Phase 5 web tests: the execution store (mocked executions API), the
 * Output panel rendering, and the workspace Run/Cancel wiring including
 * the VIEWER gate. Monaco, the collab provider and the chat client are
 * test doubles (same approach as flows/phase4 suites).
 */

const me: ApiUser = {
  id: "user-1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const project: ApiProject = {
  id: "proj-1", name: "Team Space", description: null, ownerId: "user-1", role: "OWNER",
  fileCount: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const mainJs: ApiFile = {
  id: "file-1", projectId: "proj-1", parentId: null, name: "main.js", path: "main.js",
  type: "FILE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

function doneExecution(patch: Partial<ApiExecution> = {}): ApiExecution {
  return {
    id: "exec-1", projectId: "proj-1", userId: "user-1", language: "javascript",
    status: "COMPLETED", stdout: "hello from web\n", stderr: "", exitCode: 0, executionTimeMs: 42,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z", ...patch,
  };
}

// ---------- mocks ----------

const execApiMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock("../src/lib/api/executions", () => ({ executionsApi: execApiMock }));

const backend = vi.hoisted(() => ({ role: "OWNER" as ApiProject["role"] }));
vi.mock("../src/lib/api/projects", () => ({
  projectsApi: {
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 50 })),
    get: vi.fn(async () => ({ ...project, role: backend.role })),
    listMembers: vi.fn(async () => []),
    create: vi.fn(),
    remove: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
}));
vi.mock("../src/lib/api/files", () => ({
  filesApi: {
    list: vi.fn(async () => [mainJs]),
    get: vi.fn(async () => ({ ...mainJs, content: "console.log('hello from web')" })),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listVersions: vi.fn(async () => []),
    getVersion: vi.fn(),
    saveVersion: vi.fn(),
  },
}));
vi.mock("../src/lib/api/chat", () => ({
  chatApi: {
    listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
    presence: vi.fn(async () => ({ online: [], members: [] })),
  },
}));
vi.mock("../src/lib/api/invitations", () => ({
  invitationsApi: { create: vi.fn(), list: vi.fn(async () => []), revoke: vi.fn(), preview: vi.fn(), mine: vi.fn(async () => []), accept: vi.fn(), decline: vi.fn(), acceptById: vi.fn(), declineById: vi.fn() },
}));
vi.mock("../src/lib/chat/chatClient", () => ({
  createChatClient: (events: { onStatus: (s: string) => void }) => ({
    connect: vi.fn(() => events.onStatus("connected")),
    disconnect: vi.fn(() => events.onStatus("disconnected")),
    sendMessage: vi.fn(() => true),
    sendPresence: vi.fn(),
    currentProjectId: vi.fn(() => "proj-1"),
  }),
}));
vi.mock("../src/lib/collab/provider", () => ({
  createCollabSession: (args: { projectId: string; fileId: string; user: { id: string; name: string } }) => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { id: args.user.id, name: args.user.name, color: "#f43f5e" });
    return {
      key: `${args.projectId}:${args.fileId}`, projectId: args.projectId, fileId: args.fileId,
      documentName: `project:${args.projectId}:file:${args.fileId}`,
      doc, yText: doc.getText("content"), provider: { destroy: () => undefined }, awareness,
      dispose: () => doc.destroy(),
    };
  },
}));
vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  return {
    default: (props: { onMount?: (editor: unknown) => void }) => {
      const ref = React.useRef<unknown>(null);
      if (!ref.current) {
        const model = {
          getValue: () => "",
          setValue: () => undefined,
          onDidChangeContent: () => ({ dispose: () => undefined }),
        };
        ref.current = { getModel: () => model, updateOptions: () => undefined, getAction: () => null };
      }
      // onMount fires in an effect (never during render — that loops).
      React.useEffect(() => {
        props.onMount?.(ref.current);
        // (mock editor mount effect intentionally runs once)
      }, []);
      return <div aria-label="Code editor" />;
    },
  };
});
vi.mock("y-monaco", () => ({
  MonacoBinding: class {
    destroy() { /* no-op test double */ }
  },
}));

// ---------- helpers ----------

function resetStores() {
  useExecutionStore.getState().clear();
  useAuthStore.setState({ user: me, bootstrapped: true, isLoading: false, error: null });
  useProjectStore.setState({
    projects: [], total: 0, isLoading: false, error: null, currentProject: null,
    files: [], tree: [], members: [], workspaceLoading: false, workspaceError: null, saveError: null,
  });
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useCollabStore.getState().stop();
  useChatStore.getState().disconnect();
  useUiStore.setState({ bottomPanelCollapsed: false });
}

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={["/workspace/proj-1"]}>
      <Routes>
        <Route path="/workspace/:projectId" element={<WorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.role = "OWNER";
  resetStores();
});

// ---------- execution store ----------

describe("execution store", () => {
  it("run() stores the finished execution and passes an AbortSignal", async () => {
    execApiMock.create.mockResolvedValue(doneExecution());
    await useExecutionStore.getState().run({ projectId: "proj-1", entryFileId: "file-1", entryFileName: "main.js", files: [{ fileId: "file-1" }] });
    const s = useExecutionStore.getState();
    expect(s.phase).toBe("done");
    expect(s.execution?.status).toBe("COMPLETED");
    expect(execApiMock.create).toHaveBeenCalledWith("proj-1", "file-1", [{ fileId: "file-1" }], expect.any(AbortSignal));
  });

  it("run() surfaces API errors (e.g. 400 unsupported language) as an error state", async () => {
    execApiMock.create.mockRejectedValue(new ApiClientError(400, "UNSUPPORTED_LANGUAGE", "Files ending in \".md\" cannot be executed."));
    await useExecutionStore.getState().run({ projectId: "proj-1", entryFileId: "file-9", entryFileName: "README.md", files: [] });
    const s = useExecutionStore.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("cannot be executed");
  });

  it("cancel() aborts the in-flight run and marks it cancelled", async () => {
    execApiMock.create.mockImplementation(
      (_p: string, _f: string, _files: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const pending = useExecutionStore.getState().run({ projectId: "proj-1", entryFileId: "file-1", entryFileName: "main.js", files: [] });
    expect(useExecutionStore.getState().phase).toBe("running");
    useExecutionStore.getState().cancel();
    await pending;
    const s = useExecutionStore.getState();
    expect(s.phase).toBe("done");
    expect(s.cancelledByUser).toBe(true);
    expect(s.execution).toBeNull();
  });
});

// ---------- output panel ----------

describe("OutputPanel", () => {
  it("renders stdout, stderr and the exit/duration/status footer for a finished run", () => {
    useExecutionStore.setState({
      phase: "done",
      execution: doneExecution({ stdout: "standard out\n", stderr: "a warning\n", exitCode: 3, executionTimeMs: 128, status: "FAILED" }),
      entryFileName: "main.js",
    });
    render(<OutputPanel />);
    expect(screen.getByTestId("execution-stdout")).toHaveTextContent("standard out");
    expect(screen.getByTestId("execution-stderr")).toHaveTextContent("a warning");
    expect(screen.getByTestId("execution-footer")).toHaveTextContent("Exit code 3 · Duration 128 ms · Status FAILED");
    expect(screen.getByText(/not an interactive terminal/)).toBeInTheDocument();
  });

  it("hides the stderr section when stderr is empty and Clear resets the panel", () => {
    useExecutionStore.setState({ phase: "done", execution: doneExecution({ stderr: "" }), entryFileName: "main.js" });
    render(<OutputPanel />);
    expect(screen.queryByTestId("execution-stderr")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(useExecutionStore.getState().phase).toBe("idle");
    expect(screen.getByText(/No output yet/)).toBeInTheDocument();
  });

  it("renders the error state and the cancelled state", () => {
    useExecutionStore.setState({ phase: "error", error: "Files ending in \".md\" cannot be executed.", execution: null });
    const { unmount } = render(<OutputPanel />);
    expect(screen.getByTestId("execution-error")).toHaveTextContent("cannot be executed");
    unmount();
    useExecutionStore.setState({ phase: "done", error: null, execution: null, cancelledByUser: true });
    render(<OutputPanel />);
    expect(screen.getByTestId("execution-cancelled")).toBeInTheDocument();
  });
});

// ---------- workspace wiring ----------

describe("workspace Run wiring", () => {
  it("EDITOR runs the active file and sees its captured output", async () => {
    execApiMock.create.mockResolvedValue(doneExecution());
    renderWorkspace();
    const runBtn = await screen.findByRole("button", { name: /^Run$/ });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);
    await waitFor(() => expect(execApiMock.create).toHaveBeenCalled());
    const [projectId, entryFileId, files] = execApiMock.create.mock.calls[0] as [string, string, { fileId: string }[]];
    expect(projectId).toBe("proj-1");
    expect(entryFileId).toBe("file-1");
    expect(files.map((f) => f.fileId)).toContain("file-1");
    expect(await screen.findByTestId("execution-stdout")).toHaveTextContent("hello from web");
    expect(screen.getByTestId("execution-footer")).toHaveTextContent("Status COMPLETED");
    expect(screen.getByTestId("execution-status")).toHaveTextContent("Execution: completed");
  });

  it("while running, a Cancel button replaces Run and cancelling ends the run", async () => {
    execApiMock.create.mockImplementation(
      (_p: string, _f: string, _files: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    renderWorkspace();
    const runBtn = await screen.findByRole("button", { name: /^Run$/ });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);
    const cancelBtn = await screen.findByRole("button", { name: /Cancel/ });
    expect(screen.getByTestId("run-status")).toHaveTextContent(/Running/);
    fireEvent.click(cancelBtn);
    expect(await screen.findByTestId("execution-cancelled")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Run$/ })).toBeInTheDocument();
  });

  it("VIEWER cannot run: the Run button is disabled with a View-only title", async () => {
    backend.role = "VIEWER";
    renderWorkspace();
    const runBtn = await screen.findByRole("button", { name: /^Run$/ });
    expect(runBtn).toBeDisabled();
    expect(runBtn).toHaveAttribute("title", expect.stringContaining("View-only"));
    fireEvent.click(runBtn);
    expect(execApiMock.create).not.toHaveBeenCalled();
  });

  it("an unsupported-file 400 from the API is shown in the Output panel", async () => {
    execApiMock.create.mockRejectedValue(
      new ApiClientError(400, "UNSUPPORTED_LANGUAGE", "Files ending in \".md\" cannot be executed. Supported entry points: .js, .mjs, .cjs, .py, .cpp, .cc, .cxx."),
    );
    renderWorkspace();
    const runBtn = await screen.findByRole("button", { name: /^Run$/ });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);
    expect(await screen.findByTestId("execution-error")).toHaveTextContent("cannot be executed");
    expect(screen.getByTestId("execution-status")).toHaveTextContent("Execution: error");
  });
});
