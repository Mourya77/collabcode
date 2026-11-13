import type { ProjectRole } from "@collabcode/shared";

export const ROLE_RANK: Record<ProjectRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

/** True when `role` meets or exceeds the required minimum role. */
export function roleSatisfies(role: ProjectRole, minimum: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
