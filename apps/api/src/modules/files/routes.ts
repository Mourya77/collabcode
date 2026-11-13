import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireFileAccess, requireProjectRole } from "../../middleware/projectAccess.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { FilesController } from "./controller.js";
import { createFileSchema, updateFileSchema } from "./schemas.js";
import { FilesService } from "./service.js";

/** Project-scoped file collection routes: mounted at /api/projects. */
export function projectFilesRouter(repos: Repos): Router {
  const controller = new FilesController(new FilesService(repos));
  const r = Router();
  r.use(requireAuth);
  r.post("/:projectId/files", requireProjectRole(repos, "EDITOR"), validate(createFileSchema, "body"), asyncHandler(controller.create));
  r.get("/:projectId/files", requireProjectRole(repos, "VIEWER"), asyncHandler(controller.list));
  return r;
}

/** File-by-id routes: mounted at /api/files. */
export function filesRouter(repos: Repos): Router {
  const controller = new FilesController(new FilesService(repos));
  const r = Router();
  r.use(requireAuth);
  r.get("/:fileId", requireFileAccess(repos, "VIEWER"), asyncHandler(controller.get));
  r.patch("/:fileId", requireFileAccess(repos, "EDITOR"), validate(updateFileSchema, "body"), asyncHandler(controller.update));
  r.delete("/:fileId", requireFileAccess(repos, "EDITOR"), asyncHandler(controller.remove));
  return r;
}
