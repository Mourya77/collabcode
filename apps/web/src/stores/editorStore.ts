import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SaveStatus = "saved" | "unsaved" | "saving";

interface EditorState {
  projectId: string | null;
  openTabs: string[];
  activeFileId: string | null;
  contents: Record<string, string>;
  dirtyFileIds: string[];
  saveStatus: SaveStatus;
  languageOverrides: Record<string, string>;
  fontSize: number;
  loadProject: (projectId: string, contents: Record<string, string>, initialFileId: string | null) => void;
  openFile: (fileId: string) => void;
  closeFile: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;
  setContent: (fileId: string, content: string) => void;
  setContentLoaded: (fileId: string, content: string) => void;
  markSaving: () => void;
  markSaved: () => void;
  markFileSaved: (fileId: string) => void;
  markSaveFailed: () => void;
  setLanguageOverride: (fileId: string, language: string) => void;
  setFontSize: (px: number) => void;
  reset: () => void;
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      projectId: null,
      openTabs: [],
      activeFileId: null,
      contents: {},
      dirtyFileIds: [],
      saveStatus: "saved",
      languageOverrides: {},
      fontSize: 14,

      loadProject: (projectId, contents, initialFileId) =>
        set({
          projectId,
          contents: { ...contents },
          openTabs: initialFileId ? [initialFileId] : [],
          activeFileId: initialFileId,
          dirtyFileIds: [],
          saveStatus: "saved",
          languageOverrides: {},
        }),

      openFile: (fileId) =>
        set((s) => ({
          openTabs: s.openTabs.includes(fileId) ? s.openTabs : [...s.openTabs, fileId],
          activeFileId: fileId,
        })),

      closeFile: (fileId) =>
        set((s) => {
          const openTabs = s.openTabs.filter((id) => id !== fileId);
          const activeFileId =
            s.activeFileId === fileId ? (openTabs[openTabs.length - 1] ?? null) : s.activeFileId;
          return { openTabs, activeFileId };
        }),

      setActiveFile: (fileId) => set({ activeFileId: fileId }),

      setContent: (fileId, content) =>
        set((s) => {
          if (s.contents[fileId] === content) return s;
          return {
            contents: { ...s.contents, [fileId]: content },
            dirtyFileIds: s.dirtyFileIds.includes(fileId) ? s.dirtyFileIds : [...s.dirtyFileIds, fileId],
            saveStatus: "unsaved" as SaveStatus,
          };
        }),

      /** Sets content fetched from the server WITHOUT marking the file dirty. */
      setContentLoaded: (fileId, content) =>
        set((s) => ({
          contents: { ...s.contents, [fileId]: content },
          dirtyFileIds: s.dirtyFileIds.filter((id) => id !== fileId),
        })),

      markSaving: () => set((s) => (s.saveStatus === "unsaved" ? { saveStatus: "saving" } : s)),
      markSaved: () => set({ dirtyFileIds: [], saveStatus: "saved" }),
      markFileSaved: (fileId) =>
        set((s) => {
          const dirtyFileIds = s.dirtyFileIds.filter((id) => id !== fileId);
          return { dirtyFileIds, saveStatus: dirtyFileIds.length === 0 ? ("saved" as SaveStatus) : ("unsaved" as SaveStatus) };
        }),
      markSaveFailed: () => set({ saveStatus: "unsaved" }),
      setLanguageOverride: (fileId, language) =>
        set((s) => ({ languageOverrides: { ...s.languageOverrides, [fileId]: language } })),
      setFontSize: (fontSize) => set({ fontSize: Math.min(24, Math.max(10, fontSize)) }),
      reset: () =>
        set({ projectId: null, openTabs: [], activeFileId: null, contents: {}, dirtyFileIds: [], saveStatus: "saved", languageOverrides: {} }),
    }),
    { name: "collabcode.editor", partialize: (s) => ({ fontSize: s.fontSize }) as EditorState },
  ),
);
