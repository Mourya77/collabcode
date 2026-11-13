import { env } from "../../config/env.js";
import { collabUnavailable } from "../../utils/errors.js";

/**
 * The API's client for the collaboration server's INTERNAL HTTP endpoint
 * (Phase 6 version restore). Restoring a version must be applied to the
 * live Yjs document — never as a DB-only overwrite — so the API asks the
 * collab server to perform the replacement as a CRDT transaction, and
 * treats any failure as 502 COLLAB_UNAVAILABLE with nothing written.
 */

export function buildDocumentName(projectId: string, fileId: string): string {
  return `project:${projectId}:file:${fileId}`;
}

export async function restoreOnCollabServer(documentName: string, content: string): Promise<void> {
  const base = env.COLLAB_INTERNAL_URL.replace(/\/$/, "");
  const url = `${base}/internal/documents/${encodeURIComponent(documentName)}/restore`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": env.COLLAB_INTERNAL_TOKEN },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw collabUnavailable(
      `Collaboration server unreachable — restore was not applied. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw collabUnavailable(
      `Collaboration server refused the restore (${res.status})${body?.error?.message ? `: ${body.error.message}` : ""} — restore was not applied.`,
    );
  }
}
