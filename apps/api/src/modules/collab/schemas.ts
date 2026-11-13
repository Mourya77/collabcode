import { z } from "zod";

export const collabTokenSchema = z.object({
  projectId: z.string().uuid("projectId must be a UUID."),
});

export type CollabTokenInput = z.infer<typeof collabTokenSchema>;
