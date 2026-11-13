import { z } from "zod";

export const updateMemberSchema = z.object({
  role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
