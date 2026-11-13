import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { parsePagination } from "../../utils/pagination.js";
import { validatedBody, validatedQuery } from "../../middleware/validate.js";
import type { ProjectsService } from "./service.js";
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from "./schemas.js";

export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.projects.create(req.userId as string, validatedBody<CreateProjectInput>(req));
    res.status(201).json(okEnvelope(dto, req.requestId ?? ""));
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListProjectsQuery>(req);
    const data = await this.projects.list(req.userId as string, q.search, parsePagination(req.query as Record<string, unknown>));
    res.json(okEnvelope(data, req.requestId ?? ""));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.projects.get(req.project?.id as string, req.projectRole ?? "VIEWER");
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.projects.update(req.project?.id as string, req.projectRole ?? "VIEWER", validatedBody<UpdateProjectInput>(req));
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    await this.projects.remove(req.project?.id as string);
    res.json(okEnvelope({ deleted: true }, req.requestId ?? ""));
  };
}
