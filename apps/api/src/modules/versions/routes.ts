import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireFileAccess } from "../../middleware/projectAccess.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { VersionsController } from "./controller.js";
import { createVersionSchema, restoreVersionSchema } from "./schemas.js";
import { VersionsService } from "./service.js";

/** Mounted at /api/files — paths are /:fileId/versions[/:versionId]. */
export function versionsRouter(repos: Repos): Router {
  const controller = new VersionsController(new VersionsService(repos));
  const r = Router();
  r.use(requireAuth);
  r.get("/:fileId/versions", requireFileAccess(repos, "VIEWER"), asyncHandler(controller.list));
  r.get("/:fileId/versions/:versionId", requireFileAccess(repos, "VIEWER"), asyncHandler(controller.get));
  r.post("/:fileId/versions", requireFileAccess(repos, "EDITOR"), validate(createVersionSchema, "body"), asyncHandler(controller.create));
  r.post(
    "/:fileId/versions/:versionId/restore",
    requireFileAccess(repos, "EDITOR"),
    validate(restoreVersionSchema, "body"),
    asyncHandler(controller.restore),
  );
  return r;
}
