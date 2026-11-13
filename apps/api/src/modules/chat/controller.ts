import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedQuery } from "../../middleware/validate.js";
import type { ListMessagesQuery } from "./schemas.js";
import type { ChatService } from "./service.js";

export class ChatController {
  constructor(private readonly chat: ChatService) {}

  listMessages = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListMessagesQuery>(req);
    const page = await this.chat.listMessages(req.project?.id as string, {
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
    });
    res.json(okEnvelope(page, req.requestId ?? ""));
  };

  presence = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.chat.getPresence(req.project?.id as string);
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };
}
