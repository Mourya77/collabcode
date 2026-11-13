import { api } from "./client";
import type { ApiUser } from "./types";

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export const authApi = {
  me: () => api.get<ApiUser>("/api/auth/me"),
  login: (input: LoginInput) => api.post<ApiUser>("/api/auth/login", input),
  register: (input: RegisterInput) => api.post<ApiUser>("/api/auth/register", input),
  logout: () => api.post<{ loggedOut: boolean }>("/api/auth/logout"),
  updateMe: (patch: { name?: string; avatarUrl?: string | null }) => api.patch<ApiUser>("/api/users/me", patch),
};
