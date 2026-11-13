import type { NextFunction, Request, Response } from "express";
import { forbidden } from "../utils/errors.js";
import { safeEqual } from "../utils/tokens.js";
import { CSRF_COOKIE } from "../utils/cookies.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF protection — double-submit cookie strategy.
 *
 * A non-httpOnly `cc_csrf` cookie is issued on GET /api/auth/csrf and rotated on
 * register/login/refresh. Every mutating /api request must echo that value in the
 * `x-csrf-token` header. A cross-site attacker can trigger cookie-bearing requests
 * but cannot read the cookie (same-origin policy), so they cannot forge the header.
 * Combined with SameSite=Lax session cookies this is defence in depth.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) return next();
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
  const headerToken = req.header("x-csrf-token");
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(forbidden("CSRF token missing or invalid."));
  }
  next();
}
