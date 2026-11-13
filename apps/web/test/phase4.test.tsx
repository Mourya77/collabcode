import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChatPanel } from "../src/components/ChatPanel";
import { MembersModal } from "../src/components/MembersModal";
import { WorkspacePresence } from "../src/components/WorkspacePresence";
import DashboardPage from "../src/pages/DashboardPage";
import InvitePage from "../src/pages/InvitePage";
import { ApiClientError } from "../src/lib/api/client";
import type { ChatClientEvents } from "../src/lib/chat/chatClient";
import type { ApiChatMessage, ApiFile, ApiInvitation, ApiMember, ApiMyInvitation, ApiProject, ApiUser } from "../src/lib/api/types";
import { useAuthStore } from "../src/stores/authStore";
import { useChatStore } from "../src/stores/chatStore";
import { useProjectStore } from "../src/stores/projectStore";

/**
 * Phase 4 web tests: real chat panel + store (fake WS client, mocked REST),
 * workspace presence, member management, the invite landing page and the
 * dashboard "Invitations for you" flow.
 */

const me: ApiUser = {
  id: "user-1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

function msg(id: string, content: string, senderId = "user-2", senderName = "Grace Hopper", createdAt = "2026-01-01T10:00:00.000Z"): ApiChatMessage {
  return { id, projectId: "proj-1", content, createdAt, sender: { id: senderId, name: senderName, avatarUrl: null } };
}

const fake = vi.hoisted(() => {
  const events: { current: ChatClientEvents | null } = { current: null };
  const sent: { projectId: string; content: string; clientMessageId: string }[] = [];
  const client = {
    connect: vi.fn(() => {
      events.current?.onStatus("connected");
    }),
    disconnect: vi.fn(() => {
      events.current?.onStatus("disconnected");
    }),
    sendMessage: vi.fn((projectId: string, content: string, clientMessageId: string) => {
      sent.push({ projectId, content, clientMessageId });
      return true;
    }),
    sendPresence: vi.fn(),
    currentProjectId: vi.fn(() => "proj-1"),
  };
  return { events, sent, client };
});

vi.mock("../src/lib/chat/chatClient", () => ({
  createChatClient: (events: ChatClientEvents) => {
    fake.events.current = events;
    return fake.client;
  },
}));

const chatApiMock = vi.hoisted(() => ({
  listMessages: vi.fn(),
  presence: vi.fn(),
}));
vi.mock("../src/lib/api/chat", () => ({ chatApi: chatApiMock }));

const invitationsApiMock = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
  preview: vi.fn(),
  mine: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  acceptById: vi.fn(),
  declineById: vi.fn(),
}));
vi.mock("../src/lib/api/invitations", () => ({ invitationsApi: invitationsApiMock }));

const projectsApiMock = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 50 })),
  create: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  listMembers: vi.fn(async (): Promise<ApiMember[]> => []),
  updateMemberRole: vi.fn(async (_p: string, userId: string, role: "EDITOR" | "VIEWER") => ({
    userId, role, joinedAt: "2026-01-02T00:00:00.000Z",
    user: { name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
  })),
  removeMember: vi.fn(async () => ({ removed: true })),
}));
vi.mock("../src/lib/api/projects", () => ({ projectsApi: projectsApiMock }));

const project: ApiProject = {
  id: "proj-1", name: "Team Space", description: null, ownerId: "user-1", role: "OWNER",
  fileCount: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const graceMember: ApiMember = {
  userId: "user-2", role: "EDITOR", joinedAt: "2026-01-01T00:00:00.000Z",
  user: { name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
};
const meMember: ApiMember = {
  userId: "user-1", role: "OWNER", joinedAt: "2026-01-01T00:00:00.000Z",
  user: { name: me.name, email: me.email, avatarUrl: null },
};

function resetChatStore() {
  useChatStore.getState().disconnect();
  useChatStore.setState({
    connectionStatus: "disconnected",
    messagesByProject: {},
    nextCursorByProject: {},
    historyLoadedByProject: {},
    presenceByProject: {},
    error: null,
  });
  fake.sent.length = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.client.connect.mockImplementation(() => fake.events.current?.onStatus("connected"));
  fake.client.disconnect.mockImplementation(() => fake.events.current?.onStatus("disconnected"));
  fake.client.sendMessage.mockImplementation((projectId: string, content: string, clientMessageId: string) => {
    fake.sent.push({ projectId, content, clientMessageId });
    return true;
  });
  resetChatStore();
  useAuthStore.setState({ user: me, bootstrapped: true, isLoading: false, error: null });
  useProjectStore.setState({
    projects: [], total: 0, isLoading: false, error: null, currentProject: null,
    files: [], tree: [], members: [], workspaceLoading: false, workspaceError: null, saveError: null,
  });
  chatApiMock.listMessages.mockResolvedValue({ messages: [], nextCursor: null });
  chatApiMock.presence.mockResolvedValue({ online: [], members: [] });
  invitationsApiMock.mine.mockResolvedValue([]);
  invitationsApiMock.list.mockResolvedValue([]);
});

describe("chatStore + ChatPanel (Phase 4)", () => {
  it("loads history chronologically and paginates older messages with the cursor", async () => {
    chatApiMock.listMessages
      .mockResolvedValueOnce({ messages: [msg("m2", "second", "user-2", "Grace Hopper", "2026-01-01T10:01:00.000Z"), msg("m1", "first")], nextCursor: "m1" })
      .mockResolvedValueOnce({ messages: [msg("m0", "zeroth", "user-2", "Grace Hopper", "2026-01-01T09:59:00.000Z")], nextCursor: null });
    useChatStore.getState().connect("proj-1");
    await waitFor(() => expect(useChatStore.getState().historyLoadedByProject["proj-1"]).toBe(true));
    expect(useChatStore.getState().messagesByProject["proj-1"]?.map((m) => m.content)).toEqual(["first", "second"]);
    await useChatStore.getState().loadOlder("proj-1");
    expect(useChatStore.getState().messagesByProject["proj-1"]?.map((m) => m.content)).toEqual(["zeroth", "first", "second"]);
    expect(chatApiMock.listMessages).toHaveBeenLastCalledWith("proj-1", { limit: 50, cursor: "m1" });
    // A redelivered live frame with an existing id does not duplicate.
    fake.events.current?.onMessage("proj-1", msg("m2", "second", "user-2", "Grace Hopper", "2026-01-01T10:01:00.000Z"));
    expect(useChatStore.getState().messagesByProject["proj-1"]).toHaveLength(3);
  });

  it("renders history, sends optimistically and reconciles the echo without duplicating", async () => {
    chatApiMock.listMessages.mockResolvedValue({ messages: [msg("m1", "hello from grace")], nextCursor: null });
    render(<ChatPanel projectId="proj-1" />);
    useChatStore.getState().connect("proj-1");
    expect(await screen.findByText("hello from grace")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();

    const input = screen.getByLabelText("Chat message");
    fireEvent.change(input, { target: { value: "hi grace" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.content).toBe("hi grace");
    // Optimistic copy is visible immediately, marked as sending.
    expect(screen.getByText("hi grace")).toBeInTheDocument();
    expect(screen.getByText("sending…")).toBeInTheDocument();

    // The server echo (same clientMessageId) replaces the optimistic copy.
    const cmid = fake.sent[0]?.clientMessageId as string;
    fake.events.current?.onMessage("proj-1", msg("m9", "hi grace", "user-1", "Ada Lovelace", "2026-01-01T10:02:00.000Z"), cmid);
    await waitFor(() => expect(screen.queryByText("sending…")).not.toBeInTheDocument());
    expect(screen.getAllByText("hi grace")).toHaveLength(1);
    expect(useChatStore.getState().messagesByProject["proj-1"]?.map((m) => m.id)).toEqual(["m1", "m9"]);
  });

  it("disables sending with an honest label while disconnected", async () => {
    render(<ChatPanel projectId="proj-1" />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat message")).toBeDisabled();
    expect(screen.getByText(/Chat is disconnected — sending is unavailable/)).toBeInTheDocument();
  });

  it("shows the empty state once history loaded with no messages", async () => {
    render(<ChatPanel projectId="proj-1" />);
    useChatStore.getState().connect("proj-1");
    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
  });
});

describe("WorkspacePresence (Phase 4)", () => {
  const files: ApiFile[] = [
    { id: "file-1", projectId: "proj-1", parentId: null, name: "main.ts", type: "FILE", path: "main.ts", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];

  it("shows online users with their active file and offline members with last-active", async () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    chatApiMock.presence.mockResolvedValue({
      online: [],
      members: [
        { userId: "user-1", name: me.name, email: me.email, avatarUrl: null, role: "OWNER", online: false, activeFileId: null, lastSeenAt: new Date().toISOString() },
        { userId: "user-2", name: "Grace Hopper", email: "grace@example.com", avatarUrl: null, role: "EDITOR", online: false, activeFileId: null, lastSeenAt: thirtyMinAgo },
      ],
    });
    render(<WorkspacePresence projectId="proj-1" members={[meMember, graceMember]} files={files} currentUserId="user-1" />);
    // Nobody live yet.
    expect(await screen.findByText("Nobody is connected right now.")).toBeInTheDocument();
    // A WS presence frame arrives: Ada is online editing main.ts.
    fake.events.current?.onPresence("proj-1", [
      { userId: "user-1", name: "Ada Lovelace", activeFileId: "file-1", lastSeenAt: new Date().toISOString() },
    ]);
    // Trigger the store update through the chat store path the component reads.
    useChatStore.setState((s) => ({
      presenceByProject: { ...s.presenceByProject, "proj-1": [{ userId: "user-1", name: "Ada Lovelace", activeFileId: "file-1", lastSeenAt: new Date().toISOString() }] },
    }));
    expect(await screen.findByText("Editing main.ts")).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(await screen.findByText("Last active 30m ago")).toBeInTheDocument();
  });
});

describe("MembersModal (Phase 4)", () => {
  it("owner can change a member's role; invitations tab lists and revokes", async () => {
    projectsApiMock.listMembers.mockResolvedValue([meMember, graceMember]);
    const pending: ApiInvitation = {
      id: "inv-1", projectId: "proj-1", email: "new@example.com", role: "VIEWER", status: "PENDING",
      invitedById: "user-1", expiresAt: "2026-01-08T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    invitationsApiMock.list.mockResolvedValue([pending]);
    invitationsApiMock.revoke.mockResolvedValue({ ...pending, status: "REVOKED" });
    useProjectStore.setState({ currentProject: project, members: [meMember, graceMember] });
    render(<MembersModal open onOpenChange={() => undefined} projectName="Team Space" />);

    const roleSelect = await screen.findByLabelText("Role for Grace Hopper");
    fireEvent.change(roleSelect, { target: { value: "VIEWER" } });
    await waitFor(() => expect(projectsApiMock.updateMemberRole).toHaveBeenCalledWith("proj-1", "user-2", "VIEWER"));

    fireEvent.click(screen.getByRole("tab", { name: "invitations" }));
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation for new@example.com" }));
    await waitFor(() => expect(invitationsApiMock.revoke).toHaveBeenCalledWith("proj-1", "inv-1"));
  });

  it("non-owners see read-only members and an owner-only invitations note", async () => {
    useProjectStore.setState({ currentProject: { ...project, role: "EDITOR" }, members: [meMember, graceMember] });
    render(<MembersModal open onOpenChange={() => undefined} projectName="Team Space" />);
    expect(screen.queryByLabelText("Role for Grace Hopper")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "invitations" }));
    expect(await screen.findByText(/Only the project owner can view and manage invitations/)).toBeInTheDocument();
    expect(invitationsApiMock.list).not.toHaveBeenCalled();
  });
});

describe("InvitePage (Phase 4)", () => {
  function renderInvite() {
    return render(
      <MemoryRouter initialEntries={["/invite/tok123"]}>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/workspace/:projectId" element={<p>Workspace screen</p>} />
          <Route path="/dashboard" element={<p>Dashboard screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the preview and accepting navigates into the workspace", async () => {
    invitationsApiMock.preview.mockResolvedValue({
      projectName: "Team Space", inviterName: "Ada Lovelace", role: "EDITOR", status: "PENDING",
      expiresAt: "2026-01-08T00:00:00.000Z",
    });
    invitationsApiMock.accept.mockResolvedValue({ project });
    renderInvite();
    expect(await screen.findByText(/invited you to join as/)).toBeInTheDocument();
    expect(screen.getByText("Team Space", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByText("Workspace screen")).toBeInTheDocument();
    expect(invitationsApiMock.accept).toHaveBeenCalledWith("tok123");
  });

  it("logged-out visitors are prompted to log in (return path preserved)", async () => {
    useAuthStore.setState({ user: null, bootstrapped: true });
    invitationsApiMock.preview.mockResolvedValue({
      projectName: "Team Space", inviterName: "Ada Lovelace", role: "VIEWER", status: "PENDING",
      expiresAt: "2026-01-08T00:00:00.000Z",
    });
    renderInvite();
    const loginLink = await screen.findByRole("link", { name: "Log in" });
    expect(loginLink).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("an email mismatch surfaces the API error and stays on the page", async () => {
    invitationsApiMock.preview.mockResolvedValue({
      projectName: "Team Space", inviterName: "Ada Lovelace", role: "EDITOR", status: "PENDING",
      expiresAt: "2026-01-08T00:00:00.000Z",
    });
    invitationsApiMock.accept.mockRejectedValue(
      new ApiClientError(403, "INVITATION_EMAIL_MISMATCH", "This invitation was sent to a different email address. Sign in with the invited email to respond to it."),
    );
    renderInvite();
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/sent to a different email address/);
    expect(screen.queryByText("Workspace screen")).not.toBeInTheDocument();
  });
});

describe("Dashboard invitations (Phase 4)", () => {
  it("lists invitations for the user and accepts by id into the workspace", async () => {
    const mine: ApiMyInvitation = {
      id: "inv-9", projectId: "proj-1", email: me.email, role: "EDITOR", status: "PENDING",
      invitedById: "user-2", expiresAt: "2026-01-08T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      projectName: "Team Space", inviterName: "Grace Hopper",
    };
    invitationsApiMock.mine.mockResolvedValue([mine]);
    invitationsApiMock.acceptById.mockResolvedValue({ project });
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workspace/:projectId" element={<p>Workspace screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Invitations for you")).toBeInTheDocument();
    expect(screen.getByText(/invited you to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("Workspace screen")).toBeInTheDocument();
    expect(invitationsApiMock.acceptById).toHaveBeenCalledWith("inv-9");
  });
});
