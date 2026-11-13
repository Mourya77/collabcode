import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FileNode } from "../types";
import { useUiStore } from "../stores/uiStore";
import { useExecutionStore } from "../stores/executionStore";
import { useWorkspaceStore, type BottomTab } from "../stores/workspaceStore";
import { TerminalPanel } from "./TerminalPanel";
import { OutputPanel } from "./OutputPanel";
import { ProblemsPanel, computeProblems } from "./ProblemsPanel";
import { useEditorStore } from "../stores/editorStore";
import { cn } from "../lib/utils";

const TABS: { id: BottomTab; label: string }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "output", label: "Output" },
  { id: "problems", label: "Problems" },
];

export function BottomPanel({ tree }: { tree: FileNode[] }) {
  const collapsed = useUiStore((s) => s.bottomPanelCollapsed);
  const setCollapsed = useUiStore((s) => s.setBottomPanelCollapsed);
  const height = useUiStore((s) => s.bottomPanelHeight);
  const setHeight = useUiStore((s) => s.setBottomPanelHeight);
  const tab = useWorkspaceStore((s) => s.bottomTab);
  const setTab = useWorkspaceStore((s) => s.setBottomTab);
  const execPhase = useExecutionStore((s) => s.phase);
  const execResult = useExecutionStore((s) => s.execution);
  const execStartedAt = useExecutionStore((s) => s.startedAt);
  const [, setTick] = useState(0);
  // Tick while a run is in flight so the elapsed readout stays live.
  useEffect(() => {
    if (execPhase !== "running") return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [execPhase]);
  const elapsedSec = execStartedAt ? Math.max(0, Math.floor((Date.now() - execStartedAt) / 1000)) : 0;
  const chip =
    execPhase === "running"
      ? { text: `Execution: running ${elapsedSec}s`, cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" }
      : execPhase === "error"
        ? { text: "Execution: error", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" }
        : execResult
          ? {
              text: `Execution: ${execResult.status.toLowerCase()}`,
              cls:
                execResult.status === "COMPLETED"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : execResult.status === "CANCELLED"
                    ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
            }
          : { text: "Execution: idle", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };
  const contents = useEditorStore((s) => s.contents);
  const openTabs = useEditorStore((s) => s.openTabs);
  const problemCount = computeProblems(tree, contents, openTabs).length;
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  function onDividerPointerDown(e: React.PointerEvent) {
    dragRef.current = { startY: e.clientY, startHeight: height };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      setHeight(dragRef.current.startHeight + (dragRef.current.startY - ev.clientY));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <section aria-label="Bottom panel" className="shrink-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div
        role="separator"
        aria-label="Resize bottom panel"
        aria-orientation="horizontal"
        onPointerDown={onDividerPointerDown}
        className="h-1.5 w-full cursor-row-resize hover:bg-sky-500/40"
      />
      <div className="flex items-center gap-1 px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => { setTab(t.id); setCollapsed(false); }}
            className={cn(
              "rounded px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500",
              tab === t.id && !collapsed ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {t.label}
            {t.id === "problems" && problemCount > 0 ? ` (${problemCount})` : ""}
          </button>
        ))}
        <span data-testid="execution-status" className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px]", chip.cls)}>
          {chip.text}
        </span>
        <button
          type="button"
          aria-label={collapsed ? "Expand bottom panel" : "Collapse bottom panel"}
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto rounded p-1 text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:hover:bg-zinc-800"
        >
          {collapsed ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {!collapsed && (
        <div style={{ height }} className="overflow-hidden">
          {tab === "terminal" && <TerminalPanel />}
          {tab === "output" && <OutputPanel />}
          {tab === "problems" && <ProblemsPanel tree={tree} />}
        </div>
      )}
    </section>
  );
}
