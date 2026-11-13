/**
 * Collaborative document names: `project:<projectId>:file:<fileId>`.
 * Mirrors apps/collaboration/src/documentName.ts — the server re-validates
 * everything, so this is a construction/parsing convenience, never a
 * security boundary.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildDocumentName(projectId: string, fileId: string): string {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(fileId)) {
    throw new Error(`Cannot build a document name from non-UUID ids (projectId=${projectId}, fileId=${fileId}).`);
  }
  return `project:${projectId}:file:${fileId}`;
}

export function parseDocumentName(documentName: string): { projectId: string; fileId: string } {
  const parts = typeof documentName === "string" ? documentName.split(":") : [];
  if (parts.length !== 4 || parts[0] !== "project" || parts[2] !== "file") {
    throw new Error(`Invalid document name: ${JSON.stringify(documentName)}`);
  }
  const projectId = parts[1] as string;
  const fileId = parts[3] as string;
  if (!UUID_RE.test(projectId) || !UUID_RE.test(fileId)) {
    throw new Error(`Invalid document name: ${JSON.stringify(documentName)}`);
  }
  return { projectId, fileId };
}
