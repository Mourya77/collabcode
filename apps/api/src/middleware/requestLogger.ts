import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

/** One structured log line per request: method, path, status, duration, requestId. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info(
      { requestId: req.requestId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Math.round(durationMs * 10) / 10 },
      "request",
    );
  });
  next();
}
