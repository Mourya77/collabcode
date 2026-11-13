import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedBody } from "../../middleware/validate.js";
import type { CreateExecutionInput } from "./schemas.js";
import type { ExecutionsService } from "./service.js";

export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId as string;
    // The create call blocks until the run finishes (bounded by the
    // execution service timeout). If the client goes away mid-run (browser
    // Cancel button aborts the fetch, tab closed, network drop), treat it
    // as a cancellation: mark the execution CANCELLED and kill the run
    // instead of leaving an orphan executing server-side.
    let executionId: string | null = null;
    let responded = false;
    res.on("close", () => {
      if (!responded && executionId) {
        void this.executions.cancel(userId, executionId).catch(() => undefined);
      }
    });
    const dto = await this.executions.create(userId, req.params.projectId as string, validatedBody<CreateExecutionInput>(req), (id) => {
      executionId = id;
    });
    responded = true;
    if (!res.writableEnded && !res.destroyed) {
      res.status(201).json(okEnvelope(dto, req.requestId ?? ""));
    }
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.executions.get(req.userId as string, req.params.executionId as string);
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.executions.cancel(req.userId as string, req.params.executionId as string);
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };
}
