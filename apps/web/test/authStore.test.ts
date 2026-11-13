import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../src/lib/api/client";
import type { ApiUser } from "../src/lib/api/types";

vi.mock("../src/lib/api/auth", () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateMe: vi.fn(),
  },
}));

import { authApi } from "../src/lib/api/auth";
import { useAuthStore } from "../src/stores/authStore";

const USER: ApiUser = {
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const meMock = vi.mocked(authApi.me);
const loginMock = vi.mocked(authApi.login);
const logoutMock = vi.mocked(authApi.logout);
const updateMeMock = vi.mocked(authApi.updateMe);

describe("authStore (API-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ user: null, bootstrapped: false, isLoading: false, error: null });
  });

  it("bootstrap restores the session from GET /api/auth/me", async () => {
    meMock.mockResolvedValue(USER);
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().user).toEqual(USER);
    expect(useAuthStore.getState().bootstrapped).toBe(true);
  });

  it("bootstrap with no session leaves the user null and removes Phase 1 leftovers", async () => {
    localStorage.setItem("collabcode.dev.users", "[]");
    localStorage.setItem("collabcode.dev.session", "{}");
    localStorage.setItem("collabcode.projects", "[]");
    localStorage.setItem("collabcode.editor", "{}");
    meMock.mockRejectedValue(new ApiClientError(401, "UNAUTHORIZED", "Authentication required"));
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem("collabcode.dev.users")).toBeNull();
    expect(localStorage.getItem("collabcode.dev.session")).toBeNull();
    expect(localStorage.getItem("collabcode.projects")).toBeNull();
    expect(localStorage.getItem("collabcode.editor")).toBeNull();
  });

  it("login failure surfaces the API error and returns false", async () => {
    loginMock.mockRejectedValue(new ApiClientError(401, "UNAUTHORIZED", "Invalid email or password"));
    const ok = await useAuthStore.getState().login({ email: "ada@example.com", password: "wrong-password" });
    expect(ok).toBe(false);
    expect(useAuthStore.getState().error).toBe("Invalid email or password");
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("login success stores the user", async () => {
    loginMock.mockResolvedValue(USER);
    const ok = await useAuthStore.getState().login({ email: "ada@example.com", password: "password123" });
    expect(ok).toBe(true);
    expect(useAuthStore.getState().user).toEqual(USER);
  });

  it("logout calls the API and clears local state", async () => {
    logoutMock.mockResolvedValue({ loggedOut: true });
    useAuthStore.setState({ user: USER });
    await useAuthStore.getState().logout();
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("updateProfile replaces the user with the server response", async () => {
    updateMeMock.mockResolvedValue({ ...USER, name: "Ada L." });
    useAuthStore.setState({ user: USER });
    const ok = await useAuthStore.getState().updateProfile("Ada L.");
    expect(ok).toBe(true);
    expect(useAuthStore.getState().user?.name).toBe("Ada L.");
  });
});
