/**
 * Collaborative document names: `project:<projectId>:file:<fileId>`.
 *
 * The name is the room identifier clients connect to. It is NEVER trusted:
 * both ids must be UUIDs, and the collaboration server re-validates the
 * file/project pairing and the caller's membership against the database in
 * onAuthenticate (see auth.ts) before any document is loaded.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DocumentNameParts {
  projectId: string;
  fileId: string;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function buildDocumentName(projectId: string, fileId: string): string {
  if (!isUuid(projectId) || !isUuid(fileId)) {
    throw new Error(`Cannot build a document name from non-UUID ids (projectId=${projectId}, fileId=${fileId}).`);
  }
  return `project:${projectId}:file:${fileId}`;
}

export function parseDocumentName(documentName: string): DocumentNameParts {
  const parts = typeof documentName === "string" ? documentName.split(":") : [];
  if (parts.length !== 4 || parts[0] !== "project" || parts[2] !== "file") {
    throw new Error(`Invalid document name: ${JSON.stringify(documentName)} (expected "project:<uuid>:file:<uuid>").`);
  }
  const projectId = parts[1] as string;
  const fileId = parts[3] as string;
  if (!isUuid(projectId) || !isUuid(fileId)) {
    throw new Error(`Invalid document name: ${JSON.stringify(documentName)} (ids must be UUIDs).`);
  }
  return { projectId, fileId };
}
