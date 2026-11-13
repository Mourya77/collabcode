import type { Repos } from "../../repositories/types.js";
import { notFound } from "../../utils/errors.js";
import { paginate, type Paginated, type Pagination } from "../../utils/pagination.js";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas.js";
import { toProjectDto, type ProjectDto } from "./types.js";

export const SEED_WELCOME_MD = `# Welcome to CollabCode

This project is stored on the CollabCode server (Phase 2) — your files are real
database records now, not browser-local state.

- Browse and edit files in the explorer on the left
- Files are edited live with your team — changes sync in real time (Phase 3)
- Invite teammates from the workspace Invite dialog; they join by accepting
  the invitation link (Phase 4), and project chat lives in the right panel

## Coming in later phases

- Running code with the execution service (Phase 5)
`;

export const SEED_MAIN_TS = `// Welcome to CollabCode — edit me!
export function greet(name: string): string {
  return \`Hello, \${name}! Welcome to CollabCode.\`;
}

console.log(greet("world"));
`;

export class ProjectsService {
  constructor(private readonly repos: Repos) {}

  /** Creates the project, the OWNER membership and the seed files atomically. */
  async create(userId: string, input: CreateProjectInput): Promise<ProjectDto> {
    return this.repos.withTransaction(async (r) => {
      const project = await r.projects.create({ name: input.name, description: input.description ?? null, ownerId: userId });
      await r.members.create({ projectId: project.id, userId, role: "OWNER" });
      const welcome = await r.files.create({ projectId: project.id, parentId: null, name: "welcome.md", type: "FILE", path: "welcome.md" });
      await r.versions.create({ fileId: welcome.id, createdBy: userId, content: SEED_WELCOME_MD , source: "SAVE"});
      const src = await r.files.create({ projectId: project.id, parentId: null, name: "src", type: "FOLDER", path: "src" });
      const main = await r.files.create({ projectId: project.id, parentId: src.id, name: "main.ts", type: "FILE", path: "src/main.ts" });
      await r.versions.create({ fileId: main.id, createdBy: userId, content: SEED_MAIN_TS , source: "SAVE"});
      return toProjectDto(project, "OWNER", 3);
    });
  }

  /** Lists only projects the caller is a member of, with search + pagination. */
  async list(userId: string, search: string | undefined, p: Pagination): Promise<Paginated<ProjectDto>> {
    const joined = await this.repos.members.listForUser(userId);
    const q = search?.toLowerCase();
    const filtered = joined.filter(({ project }) =>
      !q || project.name.toLowerCase().includes(q) || (project.description ?? "").toLowerCase().includes(q),
    );
    const sorted = [...filtered].sort((a, b) => b.project.updatedAt.getTime() - a.project.updatedAt.getTime());
    const page = paginate(sorted, p);
    const items: ProjectDto[] = [];
    for (const { member, project } of page.items) {
      const files = await this.repos.files.listByProject(project.id);
      items.push(toProjectDto(project, member.role, files.filter((f) => f.type === "FILE").length));
    }
    return { ...page, items };
  }

  /** Caller must already be authorised as a member (middleware); attaches the DTO. */
  async get(projectId: string, role: ProjectDto["role"]): Promise<ProjectDto> {
    const project = await this.repos.projects.findById(projectId);
    if (!project) throw notFound("Project not found.");
    const files = await this.repos.files.listByProject(projectId);
    return toProjectDto(project, role, files.filter((f) => f.type === "FILE").length);
  }

  async update(projectId: string, role: ProjectDto["role"], patch: UpdateProjectInput): Promise<ProjectDto> {
    const updated = await this.repos.projects.update(projectId, patch);
    return this.get(updated.id, role);
  }

  async remove(projectId: string): Promise<void> {
    await this.repos.projects.remove(projectId);
  }
}
