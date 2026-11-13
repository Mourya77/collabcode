import type { ProjectRole } from "@collabcode/shared";
import { api } from "./client";
import type { ApiMember, ApiProject, ProjectList } from "./types";

export const projectsApi = {
  list: (params: { search?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api.get<ProjectList>(`/api/projects${suffix}`);
  },
  create: (name: string, description?: string) =>
    api.post<ApiProject>("/api/projects", { name, ...(description ? { description } : {}) }),
  get: (projectId: string) => api.get<ApiProject>(`/api/projects/${projectId}`),
  remove: (projectId: string) => api.delete<{ deleted: boolean }>(`/api/projects/${projectId}`),
  listMembers: (projectId: string) => api.get<ApiMember[]>(`/api/projects/${projectId}/members`),
  updateMemberRole: (projectId: string, userId: string, role: Exclude<ProjectRole, "OWNER">) =>
    api.patch<ApiMember>(`/api/projects/${projectId}/members/${userId}`, { role }),
  removeMember: (projectId: string, userId: string) =>
    api.delete<{ removed: boolean }>(`/api/projects/${projectId}/members/${userId}`),
};
