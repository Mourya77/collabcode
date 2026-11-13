import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireProjectRole } from "../../middleware/projectAccess.js";
import { executionRateLimiter } from "../../middleware/rateLimits.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { ExecutionsController } from "./controller.js";
import { createExecutionSchema } from "./schemas.js";
import { ExecutionsService } from "./service.js";

/**
 * Mounted under /api/projects — run creation. EDITOR minimum: VIEWERs are
 * read-only everywhere, including execution. Non-members get 404 from
 * requireProjectRole, so project existence is not leaked.
 */
export function projectExecutionsRouter(repos: Repos): Router {
  const controller = new ExecutionsController(new ExecutionsService(repos));
  const r = Router();
  r.use(requireAuth);
  r.post(
    "/:projectId/executions",
    requireProjectRole(repos, "EDITOR"),
    executionRateLimiter,
    validate(createExecutionSchema, "body"),
    asyncHandler(controller.create),
  );
  return r;
}

/** Mounted under /api/executions — creator-only read + cancel. */
export function executionsRouter(repos: Repos): Router {
  const controller = new ExecutionsController(new ExecutionsService(repos));
  const r = Router();
  r.use(requireAuth);
  r.get("/:executionId", asyncHandler(controller.get));
  r.post("/:executionId/cancel", asyncHandler(controller.cancel));
  return r;
}
