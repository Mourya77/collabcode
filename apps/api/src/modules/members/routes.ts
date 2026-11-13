import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireProjectRole } from "../../middleware/projectAccess.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { MembersController } from "./controller.js";
import { updateMemberSchema } from "./schemas.js";
import { MembersService } from "./service.js";

/** Mounted under /api/projects — paths here are relative to that mount.
 *  Invitations live in modules/invitations (Phase 4 invite flow). */
export function membersRouter(repos: Repos): Router {
  const controller = new MembersController(new MembersService(repos));
  const r = Router();
  r.use(requireAuth);
  r.get("/:projectId/members", requireProjectRole(repos, "VIEWER"), asyncHandler(controller.list));
  r.patch("/:projectId/members/:userId", requireProjectRole(repos, "OWNER"), validate(updateMemberSchema, "body"), asyncHandler(controller.updateRole));
  r.delete("/:projectId/members/:userId", requireProjectRole(repos, "VIEWER"), asyncHandler(controller.remove));
  return r;
}
