import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";
export type ServiceState = "loading" | "ok" | "down";

interface UiState {
  theme: Theme;
  apiStatus: ServiceState;
  sidebarCollapsed: boolean;
  bottomPanelHeight: number;
  bottomPanelCollapsed: boolean;
  rightPanelOpen: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setApiStatus: (s: ServiceState) => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setBottomPanelHeight: (px: number) => void;
  setBottomPanelCollapsed: (v: boolean) => void;
  setRightPanelOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      apiStatus: "loading",
      sidebarCollapsed: false,
      bottomPanelHeight: 220,
      bottomPanelCollapsed: false,
      rightPanelOpen: true,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setApiStatus: (apiStatus) => set({ apiStatus }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setBottomPanelHeight: (bottomPanelHeight) =>
        set({ bottomPanelHeight: Math.min(480, Math.max(120, bottomPanelHeight)) }),
      setBottomPanelCollapsed: (bottomPanelCollapsed) => set({ bottomPanelCollapsed }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
    }),
    { name: "collabcode.ui", partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed, bottomPanelHeight: s.bottomPanelHeight }) as UiState },
  ),
);
