import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireProjectRole } from "../../middleware/projectAccess.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { ProjectsController } from "./controller.js";
import { createProjectSchema, listProjectsQuerySchema, updateProjectSchema } from "./schemas.js";
import { ProjectsService } from "./service.js";

export function projectsRouter(repos: Repos): Router {
  const controller = new ProjectsController(new ProjectsService(repos));
  const r = Router();
  r.use(requireAuth);
  r.post("/", validate(createProjectSchema, "body"), asyncHandler(controller.create));
  r.get("/", validate(listProjectsQuerySchema, "query"), asyncHandler(controller.list));
  r.get("/:projectId", requireProjectRole(repos, "VIEWER"), asyncHandler(controller.get));
  r.patch("/:projectId", requireProjectRole(repos, "OWNER"), validate(updateProjectSchema, "body"), asyncHandler(controller.update));
  r.delete("/:projectId", requireProjectRole(repos, "OWNER"), asyncHandler(controller.remove));
  return r;
}
