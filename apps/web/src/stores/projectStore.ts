import { create } from "zustand";
import { filesApi } from "../lib/api/files";
import { projectsApi } from "../lib/api/projects";
import { ApiClientError } from "../lib/api/client";
import type { ApiFile, ApiMember, ApiProject } from "../lib/api/types";
import type { FileNode } from "../types";

/**
 * Server-backed project state (Phase 2). Projects, files and members all come
 * from the real API — there is no local persistence of project data any more.
 */

/** Builds the explorer tree from the API's flat file list. */
export function buildTree(files: ApiFile[]): FileNode[] {
  const byId = new Map<string, FileNode>();
  for (const f of files) {
    byId.set(f.id, { id: f.id, name: f.name, type: f.type === "FOLDER" ? "folder" : "file", children: f.type === "FOLDER" ? [] : undefined });
  }
  const roots: FileNode[] = [];
  for (const f of files) {
    const node = byId.get(f.id);
    if (!node) continue;
    const parent = f.parentId ? byId.get(f.parentId) : undefined;
    if (parent?.children) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (nodes: FileNode[]): FileNode[] =>
    nodes
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1))
      .map((n) => (n.children ? { ...n, children: sortNodes(n.children) } : n));
  return sortNodes(roots);
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

interface ProjectState {
  projects: ApiProject[];
  total: number;
  isLoading: boolean;
  error: string | null;
  currentProject: ApiProject | null;
  files: ApiFile[];
  tree: FileNode[];
  members: ApiMember[];
  workspaceLoading: boolean;
  workspaceError: string | null;
  saveError: string | null;
  fetchProjects: (search?: string) => Promise<void>;
  createProject: (name: string, description: string) => Promise<ApiProject | null>;
  deleteProject: (projectId: string) => Promise<void>;
  loadWorkspace: (projectId: string) => Promise<boolean>;
  fetchMembers: (projectId: string) => Promise<void>;
  createNode: (parentId: string | null, name: string, type: "file" | "folder") => Promise<ApiFile | null>;
  deleteNode: (fileId: string) => Promise<void>;
  fetchFileContent: (fileId: string) => Promise<string | null>;
  saveFileContent: (fileId: string, content: string) => Promise<boolean>;
  clearSaveError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  total: 0,
  isLoading: false,
  error: null,
  currentProject: null,
  files: [],
  tree: [],
  members: [],
  workspaceLoading: false,
  workspaceError: null,
  saveError: null,

  async fetchProjects(search) {
    set({ isLoading: true, error: null });
    try {
      const list = await projectsApi.list({ search: search?.trim() ? search.trim() : undefined, limit: 50 });
      set({ projects: list.items, total: list.total, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: messageOf(e, "Could not load projects.") });
    }
  },

  async createProject(name, description) {
    set({ error: null });
    try {
      const project = await projectsApi.create(name.trim(), description.trim() || undefined);
      set((s) => ({ projects: [project, ...s.projects], total: s.total + 1 }));
      return project;
    } catch (e) {
      set({ error: messageOf(e, "Could not create the project.") });
      return null;
    }
  },

  async deleteProject(projectId) {
    try {
      await projectsApi.remove(projectId);
      set((s) => ({ projects: s.projects.filter((p) => p.id !== projectId), total: Math.max(0, s.total - 1) }));
    } catch (e) {
      set({ error: messageOf(e, "Could not delete the project.") });
    }
  },

  async loadWorkspace(projectId) {
    set({ workspaceLoading: true, workspaceError: null, currentProject: null, files: [], tree: [], members: [], saveError: null });
    try {
      const [project, files] = await Promise.all([projectsApi.get(projectId), filesApi.list(projectId)]);
      set({ currentProject: project, files, tree: buildTree(files), workspaceLoading: false });
      void get().fetchMembers(projectId);
      return true;
    } catch (e) {
      set({ workspaceLoading: false, workspaceError: messageOf(e, "Could not load this workspace.") });
      return false;
    }
  },

  async fetchMembers(projectId) {
    try {
      const members = await projectsApi.listMembers(projectId);
      if (get().currentProject?.id === projectId) set({ members });
    } catch {
      // Members list is auxiliary; the workspace itself already loaded.
    }
  },

  async createNode(parentId, name, type) {
    const project = get().currentProject;
    if (!project) return null;
    try {
      const file = await filesApi.create(project.id, {
        name: name.trim(),
        type: type === "folder" ? "FOLDER" : "FILE",
        parentId,
        ...(type === "file" ? { content: "" } : {}),
      });
      const files = await filesApi.list(project.id);
      set({ files, tree: buildTree(files) });
      return file;
    } catch (e) {
      set({ saveError: messageOf(e, "Could not create that file.") });
      return null;
    }
  },

  async deleteNode(fileId) {
    const project = get().currentProject;
    if (!project) return;
    try {
      await filesApi.remove(fileId);
      const files = await filesApi.list(project.id);
      set({ files, tree: buildTree(files) });
    } catch (e) {
      set({ saveError: messageOf(e, "Could not delete that file.") });
    }
  },

  async fetchFileContent(fileId) {
    try {
      const file = await filesApi.get(fileId);
      return file.content ?? "";
    } catch (e) {
      set({ saveError: messageOf(e, "Could not load that file.") });
      return null;
    }
  },

  async saveFileContent(fileId, content) {
    try {
      await filesApi.saveVersion(fileId, content);
      return true;
    } catch (e) {
      set({ saveError: messageOf(e, "Could not save your changes.") });
      return false;
    }
  },

  clearSaveError: () => set({ saveError: null }),
}));
