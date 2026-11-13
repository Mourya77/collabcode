import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import { collabApi } from "../api/collab";
import { userColor } from "./colors";
import { buildDocumentName } from "./documentName";

/**
 * Client-side collaboration session for one file (Phase 3).
 *
 * A session owns a Y.Doc whose Y.Text("content") is the editor's source of
 * truth, plus the HocuspocusProvider that syncs it over WebSocket. The
 * provider is given an async token function, so every (re)connection —
 * including reconnects after the 10-minute token lifetime — fetches a fresh
 * collab token from the API instead of replaying an expired one.
 */

export type ProviderStatus = "connecting" | "connected" | "disconnected";

export interface CollabSessionCallbacks {
  onStatus?: (status: ProviderStatus) => void;
  onSynced?: (synced: boolean) => void;
  onAuthenticationFailed?: (reason: string) => void;
  /** Phase 6: server stateless messages (persistence acknowledgements). Payload is a raw JSON string. */
  onStateless?: (payload: string) => void;
}

export interface CollabSession {
  /** `${projectId}:${fileId}` */
  key: string;
  projectId: string;
  fileId: string;
  documentName: string;
  doc: Y.Doc;
  yText: Y.Text;
  provider: HocuspocusProvider;
  awareness: Awareness;
  /** Tears down binding-adjacent resources: provider, awareness, document. */
  dispose(): void;
}

export interface CollabUser {
  id: string;
  name: string;
}

const DEFAULT_COLLAB_URL = "ws://localhost:4001";

export function createCollabSession(
  args: { projectId: string; fileId: string; user: CollabUser },
  callbacks: CollabSessionCallbacks = {},
): CollabSession {
  const documentName = buildDocumentName(args.projectId, args.fileId);
  const doc = new Y.Doc();
  const url = (import.meta.env.VITE_COLLAB_URL as string | undefined) ?? DEFAULT_COLLAB_URL;

  const provider = new HocuspocusProvider({
    url,
    name: documentName,
    document: doc,
    // Async token function: HocuspocusProvider awaits this before every
    // authentication attempt, so reconnects always use a fresh token.
    token: async () => {
      const res = await collabApi.fetchToken(args.projectId);
      return res.token;
    },
    onStatus: ({ status }) => callbacks.onStatus?.(status),
    onSynced: ({ state }) => callbacks.onSynced?.(state),
    onAuthenticationFailed: ({ reason }) => callbacks.onAuthenticationFailed?.(reason ?? "authentication failed"),
    onStateless: ({ payload }) => callbacks.onStateless?.(payload),
  });

  const awareness = provider.awareness as Awareness;
  awareness.setLocalStateField("user", {
    id: args.user.id,
    name: args.user.name,
    color: userColor(args.user.id).color,
  });

  return {
    key: `${args.projectId}:${args.fileId}`,
    projectId: args.projectId,
    fileId: args.fileId,
    documentName,
    doc,
    yText: doc.getText("content"),
    provider,
    awareness,
    dispose() {
      try {
        awareness.setLocalState(null);
      } catch {
        /* already disconnected */
      }
      provider.destroy();
      doc.destroy();
    },
  };
}
