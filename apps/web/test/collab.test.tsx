import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { COLLAB_PALETTE, colorIndexForUser, hexToRgba, userColor } from "../src/lib/collab/colors";
import { buildDocumentName, parseDocumentName } from "../src/lib/collab/documentName";
import { buildRemoteSelectionCss } from "../src/lib/collab/cursorStyles";
import { CollaboratorAvatars } from "../src/components/CollaboratorAvatars";
import { collabStatusLabel, useCollabStore } from "../src/stores/collabStore";

/**
 * Phase 3 web tests: colour/document-name utils, remote-cursor CSS, the
 * collab store's status machine (driven by a fake session factory), and
 * presence rendering from real Awareness state.
 */

const harness = vi.hoisted(() => ({
  callbacks: null as null | {
    onStatus?: (s: "connecting" | "connected" | "disconnected") => void;
    onSynced?: (b: boolean) => void;
    onAuthenticationFailed?: (r: string) => void;
  },
  awareness: null as Awareness | null,
  fireDuringCreate: false,
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
      awareness.setLocalStateField("user", {
        id: args.user.id,
        name: args.user.name,
        color: "#f43f5e",
      });
      harness.callbacks = callbacks;
      harness.awareness = awareness;
      if (harness.fireDuringCreate) {
        // The real HocuspocusProvider fires onStatus/onSynced
        // SYNCHRONOUSLY from its constructor — before createCollabSession
        // has returned. The store must survive that (Phase 7 regression:
        // it previously referenced the not-yet-initialized session
        // binding and threw a TDZ ReferenceError in the real browser).
        callbacks?.onStatus?.("connecting");
        callbacks?.onSynced?.(false);
      }
      return {
        key: `${args.projectId}:${args.fileId}`,
        projectId: args.projectId,
        fileId: args.fileId,
        documentName: `project:${args.projectId}:file:${args.fileId}`,
        doc,
        yText: doc.getText("content"),
        provider: { destroy: () => undefined },
        awareness,
        dispose: () => doc.destroy(),
      };
    },
  };
});

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";

describe("collab colours", () => {
  it("are stable for the same user id and always from the palette", () => {
    const a = userColor("user-42");
    const b = userColor("user-42");
    expect(a).toEqual(b);
    expect(COLLAB_PALETTE).toContain(a.color);
    expect(a.colorLight).toBe(`${a.color}33`);
    expect(colorIndexForUser("user-42")).toBeGreaterThanOrEqual(0);
    expect(colorIndexForUser("user-42")).toBeLessThan(COLLAB_PALETTE.length);
  });

  it("spread different users across the palette deterministically", () => {
    const indexes = new Set(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9", "u10"].map(colorIndexForUser));
    expect(indexes.size).toBeGreaterThan(3);
  });

  it("hexToRgba converts palette colours and passes through invalid input", () => {
    expect(hexToRgba("#3b82f6", 0.3)).toBe("rgba(59, 130, 246, 0.3)");
    expect(hexToRgba("not-a-color", 0.5)).toBe("not-a-color");
  });
});

describe("document names", () => {
  it("build and parse round-trip", () => {
    const name = buildDocumentName(PROJECT_ID, FILE_ID);
    expect(name).toBe(`project:${PROJECT_ID}:file:${FILE_ID}`);
    expect(parseDocumentName(name)).toEqual({ projectId: PROJECT_ID, fileId: FILE_ID });
  });

  it("reject non-UUID ids and malformed names", () => {
    expect(() => buildDocumentName("proj-1", FILE_ID)).toThrow();
    expect(() => parseDocumentName("project:proj-1:file:x")).toThrow();
    expect(() => parseDocumentName("whatever")).toThrow();
  });
});

describe("remote selection CSS", () => {
  it("generates per-client rules for remote users only, with escaped names", () => {
    const css = buildRemoteSelectionCss([
      { clientId: 7, userId: "me", name: "Me", color: "#f43f5e", isSelf: true },
      { clientId: 42, userId: "grace", name: 'Grace "GC" Hopper', color: "#3b82f6", isSelf: false },
    ]);
    expect(css).not.toContain("yRemoteSelection-7");
    expect(css).toContain(".yRemoteSelection-42 { background-color: rgba(59, 130, 246, 0.3); }");
    expect(css).toContain('.yRemoteSelectionHead-42::after { content: "Grace \\"GC\\" Hopper"; background-color: #3b82f6; }');
  });
});

describe("collab store", () => {
  beforeEach(() => {
    useCollabStore.getState().stop();
    harness.callbacks = null;
    harness.awareness = null;
    harness.fireDuringCreate = false;
  });

  it("survives provider callbacks fired synchronously during session creation (TDZ regression)", () => {
    harness.fireDuringCreate = true;
    const store = useCollabStore.getState();
    expect(() =>
      store.start({ projectId: PROJECT_ID, fileId: FILE_ID, user: { id: "me", name: "Ada" } }),
    ).not.toThrow();
    // The session was created and the store is live; later callbacks work.
    expect(useCollabStore.getState().session).not.toBeNull();
    expect(useCollabStore.getState().status).toBe("connecting");
    harness.callbacks?.onStatus?.("connected");
    expect(useCollabStore.getState().status).toBe("connected");
    useCollabStore.getState().stop();
  });

  it("walks the status machine: connecting → connected → reconnecting → stopped", () => {
    const store = useCollabStore.getState();
    store.start({ projectId: PROJECT_ID, fileId: FILE_ID, user: { id: "me", name: "Ada" } });
    expect(useCollabStore.getState().status).toBe("connecting");
    expect(collabStatusLabel("connecting", false)).toBe("Connecting…");

    harness.callbacks?.onStatus?.("connected");
    expect(useCollabStore.getState().status).toBe("connected");
    harness.callbacks?.onSynced?.(true);
    expect(useCollabStore.getState().synced).toBe(true);
    expect(collabStatusLabel("connected", true)).toBe("Live — Synced");
    expect(collabStatusLabel("connected", false)).toBe("Syncing…");

    // A dropped socket after a successful connection is "reconnecting",
    // never plain "connecting" again.
    harness.callbacks?.onStatus?.("disconnected");
    expect(useCollabStore.getState().status).toBe("reconnecting");
    harness.callbacks?.onStatus?.("connecting");
    expect(useCollabStore.getState().status).toBe("reconnecting");
    expect(collabStatusLabel("reconnecting", false)).toContain("stored locally");

    harness.callbacks?.onAuthenticationFailed?.("expired token");
    expect(useCollabStore.getState().authError).toBe("expired token");

    useCollabStore.getState().stop();
    expect(useCollabStore.getState().status).toBe("disconnected");
    expect(useCollabStore.getState().session).toBeNull();
    expect(useCollabStore.getState().liveUsers).toEqual([]);
  });

  it("starting a session for another file replaces the old one", () => {
    const store = useCollabStore.getState();
    store.start({ projectId: PROJECT_ID, fileId: FILE_ID, user: { id: "me", name: "Ada" } });
    const first = useCollabStore.getState().session;
    store.start({ projectId: PROJECT_ID, fileId: "33333333-3333-4333-8333-333333333333", user: { id: "me", name: "Ada" } });
    const second = useCollabStore.getState().session;
    expect(second).not.toBe(first);
    expect(second?.fileId).toBe("33333333-3333-4333-8333-333333333333");
    // Re-starting the same file is a no-op.
    store.start({ projectId: PROJECT_ID, fileId: "33333333-3333-4333-8333-333333333333", user: { id: "me", name: "Ada" } });
    expect(useCollabStore.getState().session).toBe(second);
  });

  it("presence follows awareness: remote users appear and disappear", () => {
    useCollabStore.getState().start({ projectId: PROJECT_ID, fileId: FILE_ID, user: { id: "me", name: "Ada" } });
    const awareness = harness.awareness;
    if (!awareness) throw new Error("fake session did not expose awareness");
    expect(useCollabStore.getState().liveUsers.map((u) => u.name)).toEqual(["Ada"]);
    expect(useCollabStore.getState().liveUsers[0]?.isSelf).toBe(true);

    const remoteDoc = new Y.Doc();
    const remote = new Awareness(remoteDoc);
    remote.setLocalStateField("user", { id: "grace", name: "Grace", color: "#3b82f6" });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(remote, [remote.clientID]), "test");
    const names = useCollabStore.getState().liveUsers.map((u) => u.name);
    expect(names).toContain("Grace");
    expect(useCollabStore.getState().liveUsers.find((u) => u.userId === "grace")?.isSelf).toBe(false);

    removeAwarenessStates(awareness, [remote.clientID], "test");
    expect(useCollabStore.getState().liveUsers.map((u) => u.name)).toEqual(["Ada"]);
  });
});

describe("presence UI", () => {
  it("CollaboratorAvatars renders live users with colours and a (you) marker", () => {
    render(
      <CollaboratorAvatars
        members={[]}
        currentUserId="me"
        liveUsers={[
          { clientId: 1, userId: "me", name: "Ada Lovelace", color: "#f43f5e", isSelf: true },
          { clientId: 2, userId: "grace", name: "Grace Hopper", color: "#3b82f6", isSelf: false },
        ]}
      />,
    );
    expect(screen.getByLabelText("Live collaborators")).toBeInTheDocument();
    expect(screen.getByTitle("Ada Lovelace (you) — live now")).toHaveTextContent("AL");
    expect(screen.getByTitle("Grace Hopper — live now")).toHaveStyle({ backgroundColor: "#3b82f6" });
  });
});
