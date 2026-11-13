import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedBody } from "../../middleware/validate.js";
import type { FilesService } from "./service.js";
import type { CreateFileInput, UpdateFileInput } from "./schemas.js";

export class FilesController {
  constructor(private readonly files: FilesService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.files.create(req.userId as string, req.project?.id as string, validatedBody<CreateFileInput>(req));
    res.status(201).json(okEnvelope(dto, req.requestId ?? ""));
  };

  list = async (req: Request, res: Response): Promise<void> => {
    res.json(okEnvelope(await this.files.list(req.project?.id as string), req.requestId ?? ""));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    res.json(okEnvelope(await this.files.get(req.file!), req.requestId ?? ""));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.files.update(req.userId as string, req.file!, validatedBody<UpdateFileInput>(req));
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    await this.files.remove(req.file!);
    res.json(okEnvelope({ deleted: true }, req.requestId ?? ""));
  };
}
