import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface ErrorBody {
  success: false;
  data: null;
  error: { code: string; message: string; details?: unknown };
  requestId: string | undefined;
}

function body(req: Request, code: string, message: string, details?: unknown): ErrorBody {
  return { success: false, data: null, error: { code, message, ...(details !== undefined ? { details } : {}) }, requestId: req.requestId };
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json(body(req, "NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(body(req, err.code, err.message, err.details));
    return;
  }
  // Body-parser failures (Phase 7): a malformed JSON body is a client error
  // (400) and an oversized body is 413 — neither is a 500, and the raw parser
  // error (which can echo request internals) is never sent to the client.
  const bp = err as { status?: unknown; type?: unknown };
  if (bp.type === "entity.parse.failed" || (err instanceof SyntaxError && bp.status === 400)) {
    res.status(400).json(body(req, "VALIDATION_ERROR", "Malformed JSON in request body."));
    return;
  }
  if (bp.type === "entity.too.large" || bp.status === 413) {
    res.status(413).json(body(req, "PAYLOAD_TOO_LARGE", "Request body is too large."));
    return;
  }
  logger.error({ requestId: req.requestId, err }, "unhandled error");
  res.status(500).json(body(req, "INTERNAL", "Internal server error"));
}

/** Wraps an async handler so rejections reach the error handler. */
export function asyncHandler<A extends Request>(
  fn: (req: A, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: A, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
