import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/tokens.js";
import { unauthorized } from "../utils/errors.js";
import { ACCESS_COOKIE } from "../utils/cookies.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Requires a valid `cc_access` JWT cookie. Sets req.userId. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  if (!token) return next(unauthorized("Authentication required."));
  const payload = verifyAccessToken(token);
  if (!payload) return next(unauthorized("Session expired or invalid. Please log in again."));
  req.userId = payload.userId;
  next();
}
