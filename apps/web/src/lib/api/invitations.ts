import { api } from "./client";
import type {
  ApiInvitation,
  ApiInvitationCreated,
  ApiInvitationPreview,
  ApiMyInvitation,
  ApiProject,
  InvitableRole,
  InvitationStatus,
} from "./types";

/**
 * Invitations v2 (Phase 4). Creating an invitation does NOT add a member —
 * the invitee joins only by accepting (POST /api/invitations/:token/accept).
 */
export const invitationsApi = {
  create: (projectId: string, email: string, role: InvitableRole) =>
    api.post<ApiInvitationCreated>(`/api/projects/${projectId}/invitations`, { email, role }),
  list: (projectId: string, status?: InvitationStatus) =>
    api.get<ApiInvitation[]>(`/api/projects/${projectId}/invitations${status ? `?status=${status}` : ""}`),
  revoke: (projectId: string, invitationId: string) =>
    api.delete<ApiInvitation>(`/api/projects/${projectId}/invitations/${invitationId}`),
  preview: (token: string) => api.get<ApiInvitationPreview>(`/api/invitations/${token}`),
  mine: () => api.get<ApiMyInvitation[]>("/api/invitations/mine"),
  accept: (token: string) => api.post<{ project: ApiProject }>(`/api/invitations/${token}/accept`),
  decline: (token: string) => api.post<ApiInvitation>(`/api/invitations/${token}/decline`),
  // Dashboard flow: the raw token is never stored, so /mine entries are
  // answered by invitation id (same email-binding/expiry rules server-side).
  acceptById: (invitationId: string) => api.post<{ project: ApiProject }>(`/api/invitations/by-id/${invitationId}/accept`),
  declineById: (invitationId: string) => api.post<ApiInvitation>(`/api/invitations/by-id/${invitationId}/decline`),
};
