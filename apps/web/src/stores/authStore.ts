import { create } from "zustand";
import { authApi, type LoginInput, type RegisterInput } from "../lib/api/auth";
import { ApiClientError } from "../lib/api/client";
import type { ApiUser } from "../lib/api/types";

export type AuthUser = ApiUser;
export type { LoginInput, RegisterInput };

/**
 * Auth state backed by the real API (Phase 2). The session itself lives in
 * httpOnly cookies set by the server — nothing auth-related is kept in
 * localStorage any more. `bootstrap()` runs once at app start and restores the
 * session via GET /api/auth/me, which is what makes login survive a refresh.
 */

// Phase 1 leftovers from the dev auth adapter / local project store. Removed
// once on boot so stale local data can never masquerade as server state.
const LEGACY_KEYS = ["collabcode.dev.users", "collabcode.dev.session", "collabcode.projects", "collabcode.editor"];

export function cleanupLegacyStorage(): void {
  for (const key of LEGACY_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // storage unavailable (private mode) — nothing to clean
    }
  }
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

interface AuthState {
  user: AuthUser | null;
  bootstrapped: boolean;
  isLoading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  login: (input: LoginInput) => Promise<boolean>;
  register: (input: RegisterInput) => Promise<boolean>;
  logout: () => Promise<void>;
  updateProfile: (name: string, avatarUrl?: string | null) => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  bootstrapped: false,
  isLoading: false,
  error: null,

  async bootstrap() {
    if (get().bootstrapped) return;
    cleanupLegacyStorage();
    try {
      const user = await authApi.me();
      set({ user, bootstrapped: true });
    } catch {
      set({ user: null, bootstrapped: true });
    }
  },

  async login(input) {
    set({ isLoading: true, error: null });
    try {
      const user = await authApi.login(input);
      set({ user, isLoading: false, bootstrapped: true });
      return true;
    } catch (e) {
      set({ isLoading: false, error: messageOf(e, "Login failed.") });
      return false;
    }
  },

  async register(input) {
    set({ isLoading: true, error: null });
    try {
      const user = await authApi.register(input);
      set({ user, isLoading: false, bootstrapped: true });
      return true;
    } catch (e) {
      set({ isLoading: false, error: messageOf(e, "Registration failed.") });
      return false;
    }
  },

  async logout() {
    try {
      await authApi.logout();
    } catch {
      // Even if the server call fails, drop local state — the UI must not
      // keep showing a session the user asked to end.
    }
    set({ user: null, error: null });
  },

  async updateProfile(name, avatarUrl) {
    const current = get().user;
    if (!current) return false;
    set({ isLoading: true, error: null });
    try {
      const user = await authApi.updateMe({ name, ...(avatarUrl !== undefined ? { avatarUrl } : {}) });
      set({ user, isLoading: false });
      return true;
    } catch (e) {
      set({ isLoading: false, error: messageOf(e, "Could not save profile.") });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
