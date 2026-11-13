import { create } from "zustand";

export type ActivityPanel = "explorer" | "search" | "scm";
export type BottomTab = "terminal" | "output" | "problems";
export type RightTab = "collaboration" | "chat";

interface WorkspaceState {
  activity: ActivityPanel;
  expandedIds: string[];
  searchQuery: string;
  bottomTab: BottomTab;
  rightTab: RightTab;
  setActivity: (a: ActivityPanel) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (ids: string[]) => void;
  setSearchQuery: (q: string) => void;
  setBottomTab: (t: BottomTab) => void;
  setRightTab: (t: RightTab) => void;
  resetWorkspaceUi: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activity: "explorer",
  expandedIds: [],
  searchQuery: "",
  bottomTab: "terminal",
  rightTab: "collaboration",
  setActivity: (activity) => set({ activity }),
  toggleExpanded: (id) =>
    set((s) => ({
      expandedIds: s.expandedIds.includes(id) ? s.expandedIds.filter((x) => x !== id) : [...s.expandedIds, id],
    })),
  setExpanded: (expandedIds) => set({ expandedIds }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  resetWorkspaceUi: () =>
    set({ activity: "explorer", expandedIds: [], searchQuery: "", bottomTab: "terminal", rightTab: "collaboration" }),
}));
