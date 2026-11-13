import { z } from "zod";

export const updateMeSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120).optional(),
  avatarUrl: z.string().url("avatarUrl must be a valid URL.").max(2048).nullable().optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
