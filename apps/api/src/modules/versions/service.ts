import type { FileRecord, Repos, VersionRecord } from "../../repositories/types.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { toFileDto, toVersionMeta, type FileDto, type VersionMetaDto } from "../files/types.js";
import { buildDocumentName, restoreOnCollabServer } from "./collabClient.js";

export interface RestoreResultDto {
  restoredVersionId: string;
  snapshotVersionId: string;
}

export class VersionsService {
  constructor(private readonly repos: Repos) {}

  /** Version metadata (no content) with the author resolved, newest first. */
  async list(file: FileRecord): Promise<VersionMetaDto[]> {
    const versions = await this.repos.versions.listByFile(file.id);
    return Promise.all(versions.map((v) => this.toMeta(v)));
  }

  async get(file: FileRecord, versionId: string): Promise<VersionMetaDto & { content: string }> {
    const version = await this.findVersion(file, versionId);
    return { ...(await this.toMeta(version)), content: version.content };
  }

  /**
   * Explicit save / snapshot: appends a new DocumentVersion and returns the
   * file with its content. A labelled create is a user SNAPSHOT; an
   * unlabelled one keeps the Phase 2 plain-save semantics (source SAVE).
   */
  async create(userId: string, file: FileRecord, content: string, label?: string): Promise<FileDto> {
    if (file.type !== "FILE") throw badRequest("Folders cannot have versions.");
    const version = await this.repos.versions.create({
      fileId: file.id,
      createdBy: userId,
      content,
      source: label ? "SNAPSHOT" : "SAVE",
      label: label ?? null,
    });
    return toFileDto(file, version.content);
  }

  /**
   * Phase 6 restore (see docs/persistence.md):
   * 1. The caller's current live content is snapshotted first
   *    (source SNAPSHOT, label "Before restore") so a restore is always
   *    reversible from history.
   * 2. The restored content is applied THROUGH the live document by the
   *    collaboration server (a CRDT transaction broadcast to everyone).
   *    If the collab server is unreachable the restore fails with 502 and
   *    the document is NOT touched — the pre-restore snapshot remains in
   *    history (harmless and honest), but no DB-only overwrite ever happens.
   * 3. No separate restore version row is written: the collab sync-back
   *    versions the restored state as AUTOSAVE, like any other live edit.
   */
  async restore(userId: string, file: FileRecord, versionId: string, currentContent: string): Promise<RestoreResultDto> {
    if (file.type !== "FILE") throw badRequest("Folders cannot have versions.");
    const version = await this.findVersion(file, versionId);

    const snapshot = await this.repos.versions.create({
      fileId: file.id,
      createdBy: userId,
      content: currentContent,
      source: "SNAPSHOT",
      label: "Before restore",
    });

    await restoreOnCollabServer(buildDocumentName(file.projectId, file.id), version.content);

    return { restoredVersionId: version.id, snapshotVersionId: snapshot.id };
  }

  private async findVersion(file: FileRecord, versionId: string): Promise<VersionRecord> {
    const version = await this.repos.versions.findById(versionId);
    if (!version || version.fileId !== file.id) throw notFound("Version not found.");
    return version;
  }

  private async toMeta(version: VersionRecord): Promise<VersionMetaDto> {
    const author = await this.repos.users.findById(version.createdBy);
    return toVersionMeta(version, author?.name);
  }
}
