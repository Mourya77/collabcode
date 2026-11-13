import type { ProjectRole } from "@collabcode/shared";

export interface MemberDto {
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  user: { name: string; email: string; avatarUrl: string | null };
}
