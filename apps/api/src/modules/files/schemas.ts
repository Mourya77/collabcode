import { z } from "zod";

export const createFileSchema = z.object({
  name: z.string(),
  type: z.enum(["FILE", "FOLDER"]),
  parentId: z.string().uuid().nullable().optional(),
  content: z.string().max(1_000_000).optional(),
});

export const updateFileSchema = z.object({
  name: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(),
  content: z.string().max(1_000_000).optional(),
});

export type CreateFileInput = z.infer<typeof createFileSchema>;
export type UpdateFileInput = z.infer<typeof updateFileSchema>;
