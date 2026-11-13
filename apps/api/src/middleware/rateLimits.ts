import type { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

/** Builds a rate limiter that answers with the standard API envelope (429 RATE_LIMITED). */
export function makeRateLimiter(opts: { windowMs: number; max: number }) {
  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        data: null,
        error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again shortly." },
        requestId: req.requestId,
      });
    },
  });
}

/** Global limiter for /api (defaults: 300 requests / 15 min / IP; relaxed under NODE_ENV=test). */
export const globalRateLimiter = makeRateLimiter({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_GLOBAL_MAX });

/** Stricter limiter for the auth endpoints (defaults: 20 / 15 min / IP; relaxed under NODE_ENV=test). */
export const authRateLimiter = makeRateLimiter({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_AUTH_MAX });

/**
 * Execution creation limiter — keyed per USER (not per IP), because runs are
 * expensive and a single account must not monopolise the execution host.
 * Default: 30 executions / hour / user (env EXECUTION_RATE_LIMIT_MAX;
 * relaxed under NODE_ENV=test). Runs after requireAuth, so req.userId is set.
 */
export const executionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.EXECUTION_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.userId ?? req.ip ?? "anonymous",
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      data: null,
      error: { code: "RATE_LIMITED", message: "Execution rate limit reached. Please wait before running more code." },
      requestId: req.requestId,
    });
  },
});
