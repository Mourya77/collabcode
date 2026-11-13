import type { FileRecord, Repos } from "../../repositories/types.js";
import { UniqueViolationError, badRequest, conflict, notFound } from "../../utils/errors.js";
import { isDescendantPath, joinPath, validateFileName } from "../../utils/paths.js";
import type { CreateFileInput, UpdateFileInput } from "./schemas.js";
import { toFileDto, type FileDto } from "./types.js";

export class FilesService {
  constructor(private readonly repos: Repos) {}

  async list(projectId: string): Promise<FileDto[]> {
    const files = await this.repos.files.listByProject(projectId);
    return files.map((f) => toFileDto(f));
  }

  /** Returns the file; FILEs include the latest version's content (null if none). */
  async get(file: FileRecord): Promise<FileDto> {
    if (file.type === "FOLDER") return toFileDto(file, null);
    const latest = await this.repos.versions.latestForFile(file.id);
    return toFileDto(file, latest?.content ?? "");
  }

  async create(userId: string, projectId: string, input: CreateFileInput): Promise<FileDto> {
    const nameError = validateFileName(input.name);
    if (nameError) throw badRequest(nameError);
    let parent: FileRecord | null = null;
    if (input.parentId) {
      parent = await this.repos.files.findById(input.parentId);
      if (!parent || parent.projectId !== projectId) throw badRequest("Parent folder does not exist in this project.");
      if (parent.type !== "FOLDER") throw badRequest("Parent must be a folder.");
    }
    const path = joinPath(parent?.path ?? null, input.name);
    const existing = await this.repos.files.findByPath(projectId, path);
    if (existing) throw conflict(`A file or folder already exists at "${path}".`);
    return this.repos.withTransaction(async (r) => {
      let file: FileRecord;
      try {
        file = await r.files.create({ projectId, parentId: parent?.id ?? null, name: input.name, type: input.type, path });
      } catch (e) {
        if (e instanceof UniqueViolationError) throw conflict(`A file or folder already exists at "${path}".`);
        throw e;
      }
      if (input.type === "FILE") {
        const version = await r.versions.create({ fileId: file.id, createdBy: userId, content: input.content ?? "" , source: "SAVE"});
        return toFileDto(file, version.content);
      }
      return toFileDto(file, null);
    });
  }

  /**
   * Rename / move / content-save. A content change always appends a new
   * DocumentVersion (in the same transaction as any rename/move). Moving or
   * renaming a folder rewrites every descendant path.
   */
  async update(userId: string, file: FileRecord, input: UpdateFileInput): Promise<FileDto> {
    const renaming = input.name !== undefined && input.name !== file.name;
    const moving = input.parentId !== undefined && input.parentId !== file.parentId;
    if (input.name !== undefined) {
      const nameError = validateFileName(input.name);
      if (nameError) throw badRequest(nameError);
    }
    if (input.content !== undefined && file.type !== "FILE") throw badRequest("Folders cannot have content.");

    let newParent: FileRecord | null = null;
    if (moving && input.parentId) {
      newParent = await this.repos.files.findById(input.parentId);
      if (!newParent || newParent.projectId !== file.projectId) throw badRequest("Target parent folder does not exist in this project.");
      if (newParent.type !== "FOLDER") throw badRequest("Target parent must be a folder.");
      if (newParent.id === file.id || isDescendantPath(newParent.path, file.path)) {
        throw badRequest("A folder cannot be moved into itself or its own subtree.");
      }
    }

    const newName = input.name ?? file.name;
    const parentPath = moving ? (newParent?.path ?? null) : await this.parentPath(file);
    const newPath = renaming || moving ? joinPath(parentPath, newName) : file.path;

    if (newPath !== file.path) {
      const clash = await this.repos.files.findByPath(file.projectId, newPath);
      if (clash && clash.id !== file.id) throw conflict(`A file or folder already exists at "${newPath}".`);
    }

    return this.repos.withTransaction(async (r) => {
      let updated = file;
      if (renaming || moving || newPath !== file.path) {
        const oldPath = file.path;
        try {
          updated = await r.files.update(file.id, {
            name: newName,
            ...(moving ? { parentId: input.parentId ?? null } : {}),
            path: newPath,
          });
        } catch (e) {
          if (e instanceof UniqueViolationError) throw conflict(`A file or folder already exists at "${newPath}".`);
          throw e;
        }
        if (file.type === "FOLDER") {
          const descendants = await r.files.listDescendants(file.projectId, oldPath);
          for (const d of descendants) {
            await r.files.update(d.id, { path: newPath + d.path.slice(oldPath.length) });
          }
        }
      }
      if (input.content !== undefined) {
        const version = await r.versions.create({ fileId: file.id, createdBy: userId, content: input.content , source: "SAVE"});
        return toFileDto(updated, version.content);
      }
      if (updated.type === "FOLDER") return toFileDto(updated, null);
      const latest = await r.versions.latestForFile(file.id);
      return toFileDto(updated, latest?.content ?? "");
    });
  }

  private async parentPath(file: FileRecord): Promise<string | null> {
    if (!file.parentId) return null;
    const parent = await this.repos.files.findById(file.parentId);
    return parent?.path ?? null;
  }

  async remove(file: FileRecord): Promise<void> {
    await this.repos.files.remove(file.id);
  }

  /** Throws 404 when the file id is unknown (used by nested routes). */
  async mustFind(fileId: string): Promise<FileRecord> {
    const file = await this.repos.files.findById(fileId);
    if (!file) throw notFound("File not found.");
    return file;
  }
}
