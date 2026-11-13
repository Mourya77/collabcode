import type { FileNode } from "../types";
import { findNode } from "../types";
import { useEditorStore } from "../stores/editorStore";

export interface Problem {
  fileId: string;
  fileName: string;
  line: number;
  message: string;
}

/** Cheap, real static checks over file contents — no fake diagnostics. */
export function computeProblems(tree: FileNode[], contents: Record<string, string>, openTabs: string[]): Problem[] {
  const problems: Problem[] = [];
  for (const fileId of openTabs) {
    const node = findNode(tree, fileId);
    const content = contents[fileId];
    if (!node || content === undefined) continue;
    content.split("\n").forEach((line, idx) => {
      if (line.length > 120) {
        problems.push({ fileId, fileName: node.name, line: idx + 1, message: `Line is ${line.length} characters (over the 120 limit)` });
      }
      if (line.includes("\t")) {
        problems.push({ fileId, fileName: node.name, line: idx + 1, message: "Line contains a tab character" });
      }
    });
  }
  return problems;
}

export function ProblemsPanel({ tree }: { tree: FileNode[] }) {
  const contents = useEditorStore((s) => s.contents);
  const openTabs = useEditorStore((s) => s.openTabs);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const problems = computeProblems(tree, contents, openTabs);

  if (problems.length === 0) {
    return <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">No problems detected in open files.</p>;
  }
  return (
    <ul className="h-full overflow-y-auto px-1 py-1" aria-label="Problems">
      {problems.map((p, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => setActiveFile(p.fileId)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <span className="font-medium text-amber-600 dark:text-amber-400">Warning</span>
            <span className="truncate">{p.message}</span>
            <span className="ml-auto shrink-0 text-zinc-400">{p.fileName}:{p.line}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
