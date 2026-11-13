import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedBody } from "../../middleware/validate.js";
import type { UsersService } from "./service.js";
import type { UpdateMeInput } from "./schemas.js";

export class UsersController {
  constructor(private readonly users: UsersService) {}

  me = async (req: Request, res: Response): Promise<void> => {
    res.json(okEnvelope(await this.users.getById(req.userId as string), req.requestId ?? ""));
  };

  updateMe = async (req: Request, res: Response): Promise<void> => {
    const patch = validatedBody<UpdateMeInput>(req);
    res.json(okEnvelope(await this.users.updateProfile(req.userId as string, patch), req.requestId ?? ""));
  };
}
