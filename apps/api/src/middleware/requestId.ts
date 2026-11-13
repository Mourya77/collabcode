import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.header("x-request-id") as string | undefined) ?? randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
