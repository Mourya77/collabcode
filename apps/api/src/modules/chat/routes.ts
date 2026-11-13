import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireProjectRole } from "../../middleware/projectAccess.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { ChatController } from "./controller.js";
import { listMessagesQuerySchema } from "./schemas.js";
import { ChatService } from "./service.js";

/**
 * Mounted under /api/projects — chat history + workspace presence.
 * Membership (any role) is required; non-members get the standard 404.
 * Sending messages happens over the WebSocket gateway (see gateway.ts).
 */
export function chatRouter(repos: Repos): Router {
  const controller = new ChatController(new ChatService(repos));
  const r = Router();
  r.use(requireAuth);
  r.get(
    "/:projectId/messages",
    requireProjectRole(repos, "VIEWER"),
    validate(listMessagesQuerySchema, "query"),
    asyncHandler(controller.listMessages),
  );
  r.get("/:projectId/presence", requireProjectRole(repos, "VIEWER"), asyncHandler(controller.presence));
  return r;
}
