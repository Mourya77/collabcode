import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { UsersController } from "./controller.js";
import { updateMeSchema } from "./schemas.js";
import { UsersService } from "./service.js";

export function usersRouter(repos: Repos): Router {
  const controller = new UsersController(new UsersService(repos));
  const r = Router();
  r.use(requireAuth);
  r.get("/me", asyncHandler(controller.me));
  r.patch("/me", validate(updateMeSchema, "body"), asyncHandler(controller.updateMe));
  return r;
}
