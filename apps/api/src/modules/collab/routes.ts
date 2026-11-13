import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { CollabController } from "./controller.js";
import { collabTokenSchema } from "./schemas.js";
import { CollabService } from "./service.js";

export function collabRouter(repos: Repos): Router {
  const controller = new CollabController(new CollabService(repos));
  const r = Router();
  r.use(requireAuth);
  r.post("/token", validate(collabTokenSchema, "body"), asyncHandler(controller.issueToken));
  return r;
}
