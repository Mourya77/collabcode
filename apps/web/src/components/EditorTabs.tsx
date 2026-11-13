import { X } from "lucide-react";
import type { FileNode } from "../types";
import { findNode } from "../types";
import { useEditorStore } from "../stores/editorStore";
import { cn } from "../lib/utils";

export function EditorTabs({ tree }: { tree: FileNode[] }) {
  const openTabs = useEditorStore((s) => s.openTabs);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const dirtyFileIds = useEditorStore((s) => s.dirtyFileIds);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);

  if (openTabs.length === 0) return null;
  return (
    <div role="tablist" aria-label="Open files" className="flex shrink-0 overflow-x-auto border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
      {openTabs.map((id) => {
        const node = findNode(tree, id);
        if (!node) return null;
        const isActive = id === activeFileId;
        const isDirty = dirtyFileIds.includes(id);
        return (
          <div
            key={id}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 border-r border-zinc-200 px-3 py-2 text-[13px] dark:border-zinc-800",
              isActive
                ? "bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            <button type="button" onClick={() => setActiveFile(id)} className="rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500">
              {node.name}
            </button>
            {isDirty && <span aria-label="Unsaved changes" title="Unsaved changes" className="h-2 w-2 rounded-full bg-amber-400" />}
            <button
              type="button"
              aria-label={`Close ${node.name}`}
              onClick={() => closeFile(id)}
              className="rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
