import type { Repos, UserRecord } from "../../repositories/types.js";
import { notFound } from "../../utils/errors.js";
import type { PublicUser } from "../auth/types.js";

export function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export class UsersService {
  constructor(private readonly repos: Repos) {}

  async getById(userId: string): Promise<PublicUser> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw notFound("User not found.");
    return toPublicUser(user);
  }

  async updateProfile(userId: string, patch: { name?: string; avatarUrl?: string | null }): Promise<PublicUser> {
    const existing = await this.repos.users.findById(userId);
    if (!existing) throw notFound("User not found.");
    const updated = await this.repos.users.update(userId, patch);
    return toPublicUser(updated);
  }
}
