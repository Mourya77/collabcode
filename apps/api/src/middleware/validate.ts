import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { badRequest } from "../utils/errors.js";

declare global {
  namespace Express {
    interface Request {
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

/**
 * Zod-validates a request part and stores the parsed value on req.validated.
 * Failures become 400 VALIDATION_ERROR with per-field details.
 */
export function validate(schema: ZodSchema, source: "body" | "query" | "params") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(
        badRequest(
          "Request validation failed.",
          result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
      );
      return;
    }
    req.validated = { ...req.validated, [source]: result.data };
    next();
  };
}

export function validatedBody<T>(req: Request): T {
  return req.validated?.body as T;
}
export function validatedQuery<T>(req: Request): T {
  return req.validated?.query as T;
}
