import { z } from "zod";

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  role: z.enum(["EDITOR", "VIEWER"]),
});

export const listInvitationsQuerySchema = z.object({
  status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"]).optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;
