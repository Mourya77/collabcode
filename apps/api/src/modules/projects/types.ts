import type { ProjectRole } from "@collabcode/shared";
import type { ProjectRecord } from "../../repositories/types.js";

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role: ProjectRole;
  fileCount: number;
}

export function toProjectDto(p: ProjectRecord, role: ProjectRole, fileCount: number): ProjectDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    role,
    fileCount,
  };
}
