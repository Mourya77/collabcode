import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(120),
  description: z.string().trim().max(500).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const listProjectsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
