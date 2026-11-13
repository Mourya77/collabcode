import { create } from "zustand";
import type { Awareness } from "y-protocols/awareness";
import { createCollabSession, type CollabSession, type CollabUser, type ProviderStatus } from "../lib/collab/provider";
import { userColor } from "../lib/collab/colors";
import type { LiveUser } from "../lib/collab/presence";

/**
 * Live collaboration state for the workspace (Phase 3): the active file's
 * Yjs session, the connection status shown in the header chip, and the
 * presence list derived from Yjs Awareness.
 *
 * Status semantics (honest by design — no silent fallback):
 * - connecting:     first connection attempt in flight
 * - connected:      WebSocket open (see `synced` for document sync state)
 * - reconnecting:   was connected before, socket dropped, provider retrying;
 *                   local edits keep landing in the Y.Doc and sync on return
 * - offline:        never connected / retries exhausted for now
 *
 * Save status (Phase 6) is driven by the server's persistence
 * acknowledgements (stateless messages), never by optimistic guessing:
 * - idle:    no local edits in this session yet (chip hidden)
 * - saving:  local edits exist that the server has not yet acknowledged
 * - saved:   the server confirmed the document state is durably stored
 * - failed:  the server reported its retry budget exhausted; it keeps
 *            retrying (sweeper) and a later ack flips this back to saved
 * - offline: local edits exist while disconnected — they live in the
 *            Y.Doc and sync (then persist) when the connection returns
 */

export type CollabStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "offline";

export type SaveState = "idle" | "saving" | "saved" | "failed" | "offline";

export function collabStatusLabel(status: CollabStatus, synced: boolean): string {
  switch (status) {
    case "connected":
      return synced ? "Live — Synced" : "Syncing…";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting… — changes stored locally";
    case "offline":
      return "Offline — changes stored locally";
    default:
      return "Not connected";
  }
}

/** Header label for the save-status chip; null hides the chip. */
export function saveStateLabel(saveState: SaveState, savedAt: string | null): string | null {
  switch (saveState) {
    case "saving":
      return "Saving…";
    case "saved": {
      if (!savedAt) return "Saved";
      const d = new Date(savedAt);
      if (Number.isNaN(d.getTime())) return "Saved";
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `Saved · ${hh}:${mm}:${ss}`;
    }
    case "failed":
      return "Save failed — retrying";
    case "offline":
      return "Offline — changes stored locally, will sync";
    default:
      return null;
  }
}

/** Reads the presence list out of an Awareness instance. */
export function readLiveUsers(awareness: Awareness): LiveUser[] {
  const users: LiveUser[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const raw = state?.user as { id?: unknown; name?: unknown; color?: unknown } | undefined;
    if (!raw || typeof raw.id !== "string") return;
    users.push({
      clientId,
      userId: raw.id,
      name: typeof raw.name === "string" ? raw.name : "Unknown user",
      color: typeof raw.color === "string" ? raw.color : userColor(raw.id).color,
      isSelf: clientId === awareness.clientID,
    });
  });
  users.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name));
  return users;
}

interface CollabState {
  session: CollabSession | null;
  status: CollabStatus;
  synced: boolean;
  liveUsers: LiveUser[];
  authError: string | null;
  /** Phase 6 save status for the active document (see the state machine above). */
  saveState: SaveState;
  /** ISO timestamp of the last server persistence acknowledgement. */
  savedAt: string | null;
  start(args: { projectId: string; fileId: string; user: CollabUser }): void;
  stop(): void;
}

export const useCollabStore = create<CollabState>()((set, get) => {
  let awarenessCleanup: (() => void) | null = null;
  let docCleanup: (() => void) | null = null;

  const stop = () => {
    awarenessCleanup?.();
    awarenessCleanup = null;
    docCleanup?.();
    docCleanup = null;
    const session = get().session;
    if (session) session.dispose();
    set({ session: null, status: "disconnected", synced: false, liveUsers: [], authError: null, saveState: "idle", savedAt: null });
  };

  return {
    session: null,
    status: "disconnected",
    synced: false,
    liveUsers: [],
    authError: null,
    saveState: "idle" as SaveState,
    savedAt: null,

    start(args) {
      const key = `${args.projectId}:${args.fileId}`;
      if (get().session?.key === key) return; // already live on this file
      stop();

      let hasConnected = false;
      // True while local edits exist that the server has not acknowledged
      // as persisted. Remote-origin updates never set this.
      let unackedEdits = false;

      // NOTE: `session` must be a nullable `let` assigned AFTER
      // createCollabSession returns. HocuspocusProvider invokes the
      // onStatus/onSynced callbacks SYNCHRONOUSLY from its constructor,
      // so a callback that referenced a `const session = create...`
      // binding would hit a temporal-dead-zone ReferenceError and the
      // session would never be created (found by the Phase 7 E2E run —
      // unit tests mock the provider and never fired callbacks during
      // construction). During construction the callbacks see
      // session === null and get().session === null, so the staleness
      // guard passes and the initial status transitions apply.
      let session: CollabSession | null = null;
      session = createCollabSession(args, {
        onStatus: (status: ProviderStatus) => {
          if (get().session !== session) return; // stale session
          if (status === "connected") {
            hasConnected = true;
            set({ status: "connected" });
            if (unackedEdits && get().saveState === "offline") set({ saveState: "saving" });
          } else if (status === "connecting") {
            set({ status: hasConnected ? "reconnecting" : "connecting" });
            if (unackedEdits) set({ saveState: "offline" });
          } else {
            set({ status: hasConnected ? "reconnecting" : "offline", synced: false });
            if (unackedEdits) set({ saveState: "offline" });
          }
        },
        onSynced: (synced) => {
          if (get().session === session) set({ synced });
        },
        onAuthenticationFailed: (reason) => {
          // The provider retries with a freshly fetched token; surface the
          // failure honestly instead of hiding it.
          if (get().session === session) set({ authError: reason });
        },
        onStateless: (payload) => {
          if (get().session !== session) return;
          let msg: { type?: unknown; at?: unknown };
          try {
            msg = JSON.parse(payload) as { type?: unknown; at?: unknown };
          } catch {
            return; // not one of ours — ignore
          }
          if (msg.type === "persisted") {
            unackedEdits = false;
            set({ saveState: "saved", savedAt: typeof msg.at === "string" ? msg.at : new Date().toISOString() });
          } else if (msg.type === "persist-failed") {
            set({ saveState: "failed" });
          }
        },
      });

      const liveSession = session;
      // Local edits (any origin other than the provider itself, which is
      // how remote updates are applied) mark the document dirty.
      const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
        if (get().session !== liveSession) return;
        if (origin === liveSession.provider) return; // remote sync — not a local edit
        unackedEdits = true;
        set({ saveState: get().status === "connected" ? "saving" : "offline" });
      };
      liveSession.doc.on("update", onDocUpdate);
      docCleanup = () => liveSession.doc.off("update", onDocUpdate);

      const rebuild = () => {
        if (get().session === liveSession) set({ liveUsers: readLiveUsers(liveSession.awareness) });
      };
      liveSession.awareness.on("change", rebuild);
      awarenessCleanup = () => liveSession.awareness.off("change", rebuild);

      set({
        session: liveSession,
        status: "connecting",
        synced: false,
        liveUsers: readLiveUsers(session.awareness),
        authError: null,
        saveState: "idle",
        savedAt: null,
      });
    },

    stop,
  };
});
