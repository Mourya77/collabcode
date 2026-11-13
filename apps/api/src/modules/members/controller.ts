import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedBody } from "../../middleware/validate.js";
import type { MembersService } from "./service.js";
import type { UpdateMemberInput } from "./schemas.js";

export class MembersController {
  constructor(private readonly members: MembersService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    res.json(okEnvelope(await this.members.list(req.project?.id as string), req.requestId ?? ""));
  };

  updateRole = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.members.updateRole(
      req.project?.id as string,
      req.userId as string,
      req.params.userId as string,
      validatedBody<UpdateMemberInput>(req),
    );
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    await this.members.remove(req.project?.id as string, req.userId as string, req.projectRole ?? "VIEWER", req.params.userId as string);
    res.json(okEnvelope({ removed: true }, req.requestId ?? ""));
  };
}
