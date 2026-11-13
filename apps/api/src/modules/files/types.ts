import type { FileRecord, VersionRecord } from "../../repositories/types.js";

export interface FileDto {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  type: "FILE" | "FOLDER";
  path: string;
  createdAt: string;
  updatedAt: string;
  content?: string | null;
}

export function toFileDto(f: FileRecord, content?: string | null): FileDto {
  return {
    id: f.id,
    projectId: f.projectId,
    parentId: f.parentId,
    name: f.name,
    type: f.type,
    path: f.path,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    ...(content !== undefined ? { content } : {}),
  };
}

export interface VersionMetaDto {
  id: string;
  fileId: string;
  createdBy: string;
  createdAt: string;
  /** Phase 6: SAVE | SNAPSHOT | RESTORE | AUTOSAVE. */
  source: VersionRecord["source"];
  label: string | null;
  author: { id: string; name: string };
  /** Content length in characters; the content itself is only in the single-version DTO. */
  sizeBytes: number;
}

export function toVersionMeta(v: VersionRecord, authorName?: string): VersionMetaDto {
  return {
    id: v.id,
    fileId: v.fileId,
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
    source: v.source,
    label: v.label,
    author: { id: v.createdBy, name: authorName ?? "Unknown user" },
    sizeBytes: v.content.length,
  };
}
