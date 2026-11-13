import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { VersionHistoryPanel } from "../src/components/VersionHistoryPanel";
import type { ApiVersionMeta } from "../src/lib/api/types";
import { saveStateLabel, useCollabStore } from "../src/stores/collabStore";

/**
 * Phase 6 web tests: the save-status state machine (driven by a fake
 * collab session: local doc updates + server stateless acknowledgements)
 * and the version history panel (mocked versions API, Monaco DiffEditor
 * test double that exposes the props it was given).
 */

// ---------- fake collab session (store tests) ----------
const harness = vi.hoisted(() => ({
  callbacks: null as null | {
    onStatus?: (s: "connecting" | "connected" | "disconnected") => void;
    onSynced?: (b: boolean) => void;
    onAuthenticationFailed?: (r: string) => void;
    onStateless?: (p: string) => void;
  },
  session: null as null | { doc: Y.Doc; yText: Y.Text; provider: { destroy: () => void } },
}));

vi.mock("../src/lib/collab/provider", async () => {
  const Yjs = await import("yjs");
  const { Awareness: FakeAwareness } = await import("y-protocols/awareness");
  return {
    createCollabSession: (
      args: { projectId: string; fileId: string; user: { id: string; name: string } },
      callbacks: typeof harness.callbacks = {},
    ) => {
      const doc = new Yjs.Doc();
      const awareness = new FakeAwareness(doc);
      awareness.setLocalStateField("user", { id: args.user.id, name: args.user.name, color: "#f43f5e" });
      const provider = { destroy: () => undefined };
      harness.callbacks = callbacks;
      harness.session = { doc, yText: doc.getText("content"), provider };
      return {
        key: `${args.projectId}:${args.fileId}`,
        projectId: args.projectId,
        fileId: args.fileId,
        documentName: `project:${args.projectId}:file:${args.fileId}`,
        doc,
        yText: doc.getText("content"),
        provider,
        awareness,
        dispose: () => doc.destroy(),
      };
    },
  };
});

// ---------- mocked versions API + DiffEditor ----------
const filesApiMock = vi.hoisted(() => ({
  listVersions: vi.fn(),
  getVersion: vi.fn(),
  saveVersion: vi.fn(),
  restoreVersion: vi.fn(),
}));
vi.mock("../src/lib/api/files", () => ({
  filesApi: {
    list: vi.fn(async () => []),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...filesApiMock,
  },
}));

vi.mock("@monaco-editor/react", () => ({
  default: () => <div aria-label="Code editor" />,
  DiffEditor: (props: { original?: string; modified?: string; language?: string }) => (
    <div data-testid="diff-editor" data-original={props.original ?? ""} data-modified={props.modified ?? ""} data-language={props.language ?? ""} />
  ),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";

function version(patch: Partial<ApiVersionMeta> = {}): ApiVersionMeta {
  return {
    id: "ver-1",
    fileId: FILE_ID,
    createdBy: "user-9",
    createdAt: "2026-11-12T10:00:00.000Z",
    source: "AUTOSAVE",
    label: null,
    author: { id: "user-9", name: "Ed Editor" },
    sizeBytes: 12,
    ...patch,
  };
}

describe("save status state machine (Phase 6)", () => {
  beforeEach(() => {
    useCollabStore.getState().stop();
    harness.callbacks = null;
    harness.session = null;
  });

  function start() {
    useCollabStore.getState().start({ projectId: PROJECT_ID, fileId: FILE_ID, user: { id: "u1", name: "Ada" } });
    harness.callbacks?.onStatus?.("connected");
    harness.callbacks?.onSynced?.(true);
  }

  it("idle → saving on a local edit → saved on the persisted ack (with timestamp)", () => {
    start();
    expect(useCollabStore.getState().saveState).toBe("idle");
    expect(saveStateLabel(useCollabStore.getState().saveState, useCollabStore.getState().savedAt)).toBeNull();

    harness.session?.yText.insert(0, "hello");
    expect(useCollabStore.getState().saveState).toBe("saving");
    expect(saveStateLabel("saving", null)).toBe("Saving…");

    harness.callbacks?.onStateless?.(JSON.stringify({ type: "persisted", at: "2026-11-12T10:11:12.000Z" }));
    const st = useCollabStore.getState();
    expect(st.saveState).toBe("saved");
    expect(st.savedAt).toBe("2026-11-12T10:11:12.000Z");
    expect(saveStateLabel(st.saveState, st.savedAt)).toMatch(/^Saved · \d{2}:\d{2}:\d{2}$/);
  });

  it("remote-origin updates do not mark the document dirty", () => {
    start();
    const s = harness.session;
    expect(s).not.toBeNull();
    s?.doc.transact(() => s.yText.insert(0, "from a peer"), s.provider);
    expect(useCollabStore.getState().saveState).toBe("idle");
  });

  it("persist-failed shows the failure state; a later ack recovers to saved", () => {
    start();
    harness.session?.yText.insert(0, "x");
    harness.callbacks?.onStateless?.(JSON.stringify({ type: "persist-failed" }));
    expect(useCollabStore.getState().saveState).toBe("failed");
    expect(saveStateLabel("failed", null)).toBe("Save failed — retrying");
    harness.callbacks?.onStateless?.(JSON.stringify({ type: "persisted", at: "2026-11-12T10:12:00.000Z" }));
    expect(useCollabStore.getState().saveState).toBe("saved");
  });

  it("edits made while disconnected read as offline, then saving on reconnect", () => {
    start();
    harness.callbacks?.onStatus?.("disconnected");
    harness.session?.yText.insert(0, "offline edit");
    expect(useCollabStore.getState().saveState).toBe("offline");
    expect(saveStateLabel("offline", null)).toBe("Offline — changes stored locally, will sync");
    harness.callbacks?.onStatus?.("connected");
    expect(useCollabStore.getState().saveState).toBe("saving");
  });

  it("ignores unrelated or malformed stateless payloads", () => {
    start();
    harness.callbacks?.onStateless?.("not json");
    harness.callbacks?.onStateless?.(JSON.stringify({ type: "something-else" }));
    expect(useCollabStore.getState().saveState).toBe("idle");
  });
});

describe("VersionHistoryPanel (Phase 6)", () => {
  const versions: ApiVersionMeta[] = [
    version({ id: "ver-2", source: "SNAPSHOT", label: "Before restore", createdAt: "2026-11-12T11:00:00.000Z", sizeBytes: 20 }),
    version({ id: "ver-1", source: "AUTOSAVE", createdAt: "2026-11-12T10:00:00.000Z", sizeBytes: 12 }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    filesApiMock.listVersions.mockResolvedValue(versions);
    filesApiMock.getVersion.mockResolvedValue({ ...versions[1], content: "old content v1" });
    filesApiMock.saveVersion.mockResolvedValue({});
    filesApiMock.restoreVersion.mockResolvedValue({ restoredVersionId: "ver-1", snapshotVersionId: "ver-3" });
  });

  function renderPanel(canEdit = true) {
    return render(
      <VersionHistoryPanel
        open
        onOpenChange={() => undefined}
        fileId={FILE_ID}
        fileName="main.ts"
        canEdit={canEdit}
        getCurrentContent={() => "current live content"}
      />,
    );
  }

  it("renders the version list with source badges, labels, authors and sizes", async () => {
    renderPanel();
    expect(await screen.findByText("Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Autosave")).toBeInTheDocument();
    expect(screen.getByText(/“Before restore”/)).toBeInTheDocument();
    expect(screen.getAllByText(/Ed Editor/).length).toBeGreaterThan(0);
    expect(screen.getByText(/12 chars/)).toBeInTheDocument();
  });

  it("opens the diff with the version content as original and the live content as modified", async () => {
    renderPanel();
    const diffButtons = await screen.findAllByRole("button", { name: /Preview diff/ });
    fireEvent.click(diffButtons[1] as HTMLElement);
    const editor = await screen.findByTestId("diff-editor");
    expect(editor).toHaveAttribute("data-original", "old content v1");
    expect(editor).toHaveAttribute("data-modified", "current live content");
    expect(editor).toHaveAttribute("data-language", "typescript");
    expect(filesApiMock.getVersion).toHaveBeenCalledWith(FILE_ID, "ver-1");
  });

  it("restore requires confirmation, sends the live content, and reports the snapshot notice", async () => {
    renderPanel();
    const restoreButtons = await screen.findAllByRole("button", { name: /^Restore version/ });
    fireEvent.click(restoreButtons[1] as HTMLElement);
    // Confirmation first — nothing has been sent yet.
    expect(filesApiMock.restoreVersion).not.toHaveBeenCalled();
    expect(screen.getByText(/will first be saved as a snapshot/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(filesApiMock.restoreVersion).toHaveBeenCalledWith(FILE_ID, "ver-1", "current live content"));
    expect(await screen.findByText("Restored — a snapshot of the previous content was saved.")).toBeInTheDocument();
  });

  it("creates a snapshot with the typed label and the live content", async () => {
    renderPanel();
    await screen.findByText("Autosave");
    fireEvent.change(screen.getByLabelText("Snapshot label (optional)"), { target: { value: "Milestone 1" } });
    fireEvent.click(screen.getByRole("button", { name: /Create snapshot/ }));
    await waitFor(() => expect(filesApiMock.saveVersion).toHaveBeenCalledWith(FILE_ID, "current live content", "Milestone 1"));
    expect(await screen.findByText(/Snapshot “Milestone 1” created/)).toBeInTheDocument();
  });

  it("VIEWER sees history and diffs but no restore or snapshot controls", async () => {
    renderPanel(false);
    expect(await screen.findByText("Autosave")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Restore version/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create snapshot/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Preview diff/ }).length).toBeGreaterThan(0);
  });
});
