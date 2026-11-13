import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { validatedBody, validatedQuery } from "../../middleware/validate.js";
import type { ProjectRecord } from "../../repositories/types.js";
import type { InvitationsService } from "./service.js";
import type { CreateInvitationInput, ListInvitationsQuery } from "./schemas.js";

export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.invitations.create(
      req.userId as string,
      req.project as ProjectRecord,
      validatedBody<CreateInvitationInput>(req),
    );
    res.status(201).json(okEnvelope(dto, req.requestId ?? ""));
  };

  listForProject = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListInvitationsQuery>(req);
    const rows = await this.invitations.listForProject(req.project as ProjectRecord, q.status);
    res.json(okEnvelope(rows, req.requestId ?? ""));
  };

  revoke = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.invitations.revoke(req.project as ProjectRecord, req.params.invitationId as string);
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  preview = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.invitations.preview(req.params.token as string);
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  mine = async (req: Request, res: Response): Promise<void> => {
    const rows = await this.invitations.listMine(req.userId as string);
    res.json(okEnvelope(rows, req.requestId ?? ""));
  };

  accept = async (req: Request, res: Response): Promise<void> => {
    const project = await this.invitations.accept(req.userId as string, req.params.token as string);
    res.json(okEnvelope({ project }, req.requestId ?? ""));
  };

  decline = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.invitations.decline(req.userId as string, req.params.token as string);
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };

  acceptById = async (req: Request, res: Response): Promise<void> => {
    const project = await this.invitations.acceptById(req.userId as string, req.params.invitationId as string);
    res.json(okEnvelope({ project }, req.requestId ?? ""));
  };

  declineById = async (req: Request, res: Response): Promise<void> => {
    const dto = await this.invitations.declineById(req.userId as string, req.params.invitationId as string);
    res.json(okEnvelope(dto, req.requestId ?? ""));
  };
}
