import type { NextFunction, Request, Response } from "express";
import type { ProjectRole } from "@collabcode/shared";
import type { Repos, ProjectRecord, FileRecord } from "../repositories/types.js";
import { notFound, forbidden } from "../utils/errors.js";
import { roleSatisfies } from "../utils/roles.js";
import { asyncHandler } from "./errorHandler.js";

declare global {
  namespace Express {
    interface Request {
      project?: ProjectRecord;
      projectRole?: ProjectRole;
      file?: FileRecord;
    }
  }
}

/**
 * Loads the project from :projectId and the caller's membership.
 * Non-members get 404 (never 403) so project existence is not leaked;
 * members below the minimum role get 403.
 */
export function requireProjectRole(repos: Repos, minimum: ProjectRole) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const projectId = req.params.projectId;
    if (!projectId || !req.userId) throw notFound("Project not found.");
    const project = await repos.projects.findById(projectId);
    if (!project) throw notFound("Project not found.");
    const member = await repos.members.find(projectId, req.userId);
    if (!member) throw notFound("Project not found.");
    if (!roleSatisfies(member.role, minimum)) throw forbidden("Your role in this project does not allow that.");
    req.project = project;
    req.projectRole = member.role;
    next();
  });
}

/**
 * Same rule, but resolves the project through :fileId (for /api/files/* routes).
 * Any lookup failure along the chain is a 404 for non-members.
 */
export function requireFileAccess(repos: Repos, minimum: ProjectRole) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const fileId = req.params.fileId;
    if (!fileId || !req.userId) throw notFound("File not found.");
    const file = await repos.files.findById(fileId);
    if (!file) throw notFound("File not found.");
    const project = await repos.projects.findById(file.projectId);
    if (!project) throw notFound("File not found.");
    const member = await repos.members.find(file.projectId, req.userId);
    if (!member) throw notFound("File not found.");
    if (!roleSatisfies(member.role, minimum)) throw forbidden("Your role in this project does not allow that.");
    req.file = file;
    req.project = project;
    req.projectRole = member.role;
    next();
  });
}
