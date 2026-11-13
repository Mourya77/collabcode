import { FolderCode, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { ApiProject } from "../lib/api/types";

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectCard({ project, onDelete }: { project: ApiProject; onDelete?: (id: string) => void }) {
  const fileCount = project.fileCount;
  return (
    <div className="group flex flex-col rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <FolderCode className="h-5 w-5 text-sky-500" aria-hidden />
        {onDelete && (
          <button
            type="button"
            aria-label={`Delete project ${project.name}`}
            onClick={() => onDelete(project.id)}
            className="rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 group-hover:opacity-100 dark:hover:bg-zinc-800"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <Link
        to={`/workspace/${project.id}`}
        className="mt-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <h3 className="truncate text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-50">{project.name}</h3>
      </Link>
      <p className="mt-1 line-clamp-2 min-h-5 text-sm text-zinc-500 dark:text-zinc-400">
        {project.description || "No description"}
      </p>
      <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
        {fileCount} {fileCount === 1 ? "file" : "files"} · {project.role} · Updated {formatRelative(project.updatedAt)}
      </p>
    </div>
  );
}
