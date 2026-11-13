import { useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, FileCode2, FileJson2, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import type { FileNode } from "../types";
import { flattenFiles } from "../types";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { cn } from "../lib/utils";

function FileIcon({ name }: { name: string }) {
  if (name.endsWith(".json")) return <FileJson2 className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />;
  if (name.endsWith(".md") || name.endsWith(".txt")) return <FileText className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />;
  return <FileCode2 className="h-4 w-4 shrink-0 text-sky-500" aria-hidden />;
}

interface CreatingState {
  parentId: string | null;
  type: "file" | "folder";
}

/** Server-backed explorer: the tree comes from the API via the project store. */
export function FileExplorer({ tree, readOnly = false }: { tree: FileNode[]; readOnly?: boolean }) {
  const expandedIds = useWorkspaceStore((s) => s.expandedIds);
  const toggleExpanded = useWorkspaceStore((s) => s.toggleExpanded);
  const searchQuery = useWorkspaceStore((s) => s.searchQuery);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const openFile = useEditorStore((s) => s.openFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const createNode = useProjectStore((s) => s.createNode);
  const deleteNode = useProjectStore((s) => s.deleteNode);
  const setContentLoaded = useEditorStore((s) => s.setContentLoaded);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [newName, setNewName] = useState("");

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!creating || !newName.trim()) return;
    const node = await createNode(creating.parentId, newName, creating.type);
    if (node) {
      if (creating.parentId && !expandedIds.includes(creating.parentId)) toggleExpanded(creating.parentId);
      if (node.type === "FILE") {
        setContentLoaded(node.id, node.content ?? "");
        openFile(node.id);
      }
    }
    setCreating(null);
    setNewName("");
  }

  function handleDelete(node: FileNode) {
    const ids: string[] = [];
    const walk = (n: FileNode) => {
      ids.push(n.id);
      n.children?.forEach(walk);
    };
    walk(node);
    ids.forEach((id) => closeFile(id));
    void deleteNode(node.id);
  }

  const createForm = creating && (
    <form onSubmit={(e) => void submitCreate(e)} className="flex items-center gap-1 px-2 py-1">
      <input
        aria-label={creating.type === "file" ? "New file name" : "New folder name"}
        autoFocus
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onBlur={() => { setCreating(null); setNewName(""); }}
        placeholder={creating.type === "file" ? "file.ts" : "folder"}
        className="h-7 w-full rounded border border-sky-500 bg-white px-2 text-xs text-zinc-900 focus:outline-none dark:bg-zinc-900 dark:text-zinc-100"
      />
    </form>
  );

  function renderNodes(nodes: FileNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      if (node.type === "folder") {
        const expanded = expandedIds.includes(node.id);
        return (
          <div key={node.id}>
            <div
              className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
              style={{ paddingLeft: `${depth * 12 + 4}px` }}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} folder ${node.name}`}
                onClick={() => toggleExpanded(node.id)}
                className="flex min-w-0 flex-1 items-center gap-1 text-left text-[13px] text-zinc-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:text-zinc-200"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                {expanded ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" aria-hidden /> : <Folder className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />}
                <span className="truncate">{node.name}</span>
              </button>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    aria-label={`Add file in ${node.name}`}
                    onClick={() => setCreating({ parentId: node.id, type: "file" })}
                    className="rounded p-0.5 text-zinc-400 opacity-0 hover:text-zinc-700 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100 dark:hover:text-zinc-200"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete folder ${node.name}`}
                    onClick={() => handleDelete(node)}
                    className="rounded p-0.5 text-zinc-400 opacity-0 hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </>
              )}
            </div>
            {expanded && creating?.parentId === node.id && createForm}
            {expanded && node.children && renderNodes(node.children, depth + 1)}
          </div>
        );
      }
      const isActive = activeFileId === node.id;
      return (
        <div
          key={node.id}
          className={cn(
            "group flex items-center gap-1 rounded px-1 py-0.5",
            isActive ? "bg-sky-100 dark:bg-sky-950" : "hover:bg-zinc-200/70 dark:hover:bg-zinc-800",
          )}
          style={{ paddingLeft: `${depth * 12 + 16}px` }}
        >
          <button
            type="button"
            aria-label={`Open file ${node.name}`}
            aria-current={isActive ? "true" : undefined}
            onClick={() => openFile(node.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] text-zinc-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:text-zinc-200"
          >
            <FileIcon name={node.name} />
            <span className="truncate">{node.name}</span>
          </button>
          {!readOnly && (
            <button
              type="button"
              aria-label={`Delete file ${node.name}`}
              onClick={() => handleDelete(node)}
              className="rounded p-0.5 text-zinc-400 opacity-0 hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      );
    });
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    const matches = flattenFiles(tree).filter((f) => f.name.toLowerCase().includes(q));
    return (
      <div className="p-1" role="tree" aria-label="File search results">
        {matches.length === 0 && <p className="px-2 py-2 text-xs text-zinc-500">No files match “{searchQuery}”.</p>}
        {matches.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => openFile(f.id)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] text-zinc-700 hover:bg-zinc-200/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <FileIcon name={f.name} /> <span className="truncate">{f.name}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      {!readOnly && (
        <div className="flex items-center justify-end gap-0.5 px-2 pt-1">
          <button
            type="button"
            aria-label="New file"
            onClick={() => setCreating({ parentId: null, type: "file" })}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="New folder"
            onClick={() => setCreating({ parentId: null, type: "folder" })}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <FolderPlus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      <div className="p-1" role="tree" aria-label="Files">
        {creating?.parentId === null && createForm}
        {tree.length === 0 && <p className="px-2 py-2 text-xs text-zinc-500">No files yet.{readOnly ? "" : " Create one above."}</p>}
        {renderNodes(tree, 0)}
      </div>
    </div>
  );
}
