import { api } from "./client";
import type { ApiFile, ApiRestoreResult, ApiVersionMeta } from "./types";

export const filesApi = {
  list: (projectId: string) => api.get<ApiFile[]>(`/api/projects/${projectId}/files`),
  get: (fileId: string) => api.get<ApiFile>(`/api/files/${fileId}`),
  create: (projectId: string, body: { name: string; type: "FILE" | "FOLDER"; parentId?: string | null; content?: string }) =>
    api.post<ApiFile>(`/api/projects/${projectId}/files`, body),
  update: (fileId: string, body: { name?: string; parentId?: string | null; content?: string }) =>
    api.patch<ApiFile>(`/api/files/${fileId}`, body),
  remove: (fileId: string) => api.delete<{ deleted: boolean }>(`/api/files/${fileId}`),
  listVersions: (fileId: string) => api.get<ApiVersionMeta[]>(`/api/files/${fileId}/versions`),
  getVersion: (fileId: string, versionId: string) =>
    api.get<ApiVersionMeta & { content: string }>(`/api/files/${fileId}/versions/${versionId}`),
  saveVersion: (fileId: string, content: string, label?: string) =>
    api.post<ApiFile>(`/api/files/${fileId}/versions`, label ? { content, label } : { content }),
  /** Phase 6: restore a version through the live document; currentContent is snapshotted server-side first. */
  restoreVersion: (fileId: string, versionId: string, currentContent: string) =>
    api.post<ApiRestoreResult>(`/api/files/${fileId}/versions/${versionId}/restore`, { currentContent }),
};
