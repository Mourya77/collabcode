import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedBody } from "../../middleware/validate.js";
import type { VersionsService } from "./service.js";
import type { CreateVersionInput, RestoreVersionInput } from "./schemas.js";

export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    res.json(okEnvelope(await this.versions.list(req.file!), req.requestId ?? ""));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    res.json(okEnvelope(await this.versions.get(req.file!, req.params.versionId as string), req.requestId ?? ""));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateVersionInput>(req);
    const dto = await this.versions.create(req.userId as string, req.file!, body.content, body.label);
    res.status(201).json(okEnvelope(dto, req.requestId ?? ""));
  };

  restore = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<RestoreVersionInput>(req);
    const dto = await this.versions.restore(
      req.userId as string,
      req.file!,
      req.params.versionId as string,
      body.currentContent,
    );
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };
}
