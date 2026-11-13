import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireProjectRole } from "../../middleware/projectAccess.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { InvitationsController } from "./controller.js";
import { createInvitationSchema, listInvitationsQuerySchema } from "./schemas.js";
import { InvitationsService } from "./service.js";

/** Mounted under /api/projects — project-scoped invitation management (OWNER only). */
export function projectInvitationsRouter(repos: Repos): Router {
  const controller = new InvitationsController(new InvitationsService(repos));
  const r = Router();
  r.use(requireAuth);
  r.post(
    "/:projectId/invitations",
    requireProjectRole(repos, "OWNER"),
    validate(createInvitationSchema, "body"),
    asyncHandler(controller.create),
  );
  r.get(
    "/:projectId/invitations",
    requireProjectRole(repos, "OWNER"),
    validate(listInvitationsQuerySchema, "query"),
    asyncHandler(controller.listForProject),
  );
  r.delete(
    "/:projectId/invitations/:invitationId",
    requireProjectRole(repos, "OWNER"),
    asyncHandler(controller.revoke),
  );
  return r;
}

/**
 * Mounted under /api/invitations — token-scoped endpoints.
 * `/mine` is registered before `/:token` so it is not captured as a token.
 * The preview route is public (the unguessable token is the credential);
 * accept/decline require an authenticated session whose email must match.
 */
export function invitationsRouter(repos: Repos): Router {
  const controller = new InvitationsController(new InvitationsService(repos));
  const r = Router();
  r.get("/mine", requireAuth, asyncHandler(controller.mine));
  // By-id respond flow for the dashboard (the raw token is never stored, so
  // /mine cannot rebuild invite links). Registered before /:token routes.
  r.post("/by-id/:invitationId/accept", requireAuth, asyncHandler(controller.acceptById));
  r.post("/by-id/:invitationId/decline", requireAuth, asyncHandler(controller.declineById));
  r.get("/:token", asyncHandler(controller.preview));
  r.post("/:token/accept", requireAuth, asyncHandler(controller.accept));
  r.post("/:token/decline", requireAuth, asyncHandler(controller.decline));
  return r;
}
