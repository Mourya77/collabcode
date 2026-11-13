import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedBody } from "../../middleware/validate.js";
import type { CollabTokenInput } from "./schemas.js";
import type { CollabService } from "./service.js";

export class CollabController {
  constructor(private readonly collab: CollabService) {}

  issueToken = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.collab.issueToken(req.userId as string, validatedBody<CollabTokenInput>(req));
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };
}
