import { Router } from "express";
import type { Repos } from "../../repositories/types.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { authRateLimiter } from "../../middleware/rateLimits.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { UsersService } from "../users/service.js";
import { AuthController } from "./controller.js";
import { loginSchema, registerSchema } from "./schemas.js";
import { AuthService } from "./service.js";

export function authRouter(repos: Repos): Router {
  const controller = new AuthController(new AuthService(repos), new UsersService(repos));
  const r = Router();
  r.use(authRateLimiter);
  r.get("/csrf", controller.csrf);
  r.post("/register", validate(registerSchema, "body"), asyncHandler(controller.register));
  r.post("/login", validate(loginSchema, "body"), asyncHandler(controller.login));
  r.post("/refresh", asyncHandler(controller.refresh));
  r.post("/logout", asyncHandler(controller.logout));
  r.get("/me", requireAuth, asyncHandler(controller.me));
  return r;
}
