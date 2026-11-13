import { Eraser } from "lucide-react";
import { useExecutionStore } from "../stores/executionStore";

/**
 * Phase 5 — captured program output. This panel shows the stdout/stderr a
 * run produced in the isolated execution service. It is NOT an interactive
 * terminal: the program has already finished (or was stopped), and there
 * is no input prompt. The Terminal tab remains the (still disconnected)
 * interactive shell placeholder.
 */
export function OutputPanel() {
  const phase = useExecutionStore((s) => s.phase);
  const execution = useExecutionStore((s) => s.execution);
  const error = useExecutionStore((s) => s.error);
  const cancelledByUser = useExecutionStore((s) => s.cancelledByUser);
  const entryFileName = useExecutionStore((s) => s.entryFileName);
  const clear = useExecutionStore((s) => s.clear);

  return (
    <div className="flex h-full flex-col" aria-label="Execution output">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-900">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Program output{entryFileName ? ` — ${entryFileName}` : ""}
        </span>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Captured output — not an interactive terminal</span>
        <button
          type="button"
          onClick={clear}
          disabled={phase === "running"}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden /> Clear
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
        {phase === "idle" && (
          <p className="text-zinc-500 dark:text-zinc-400">
            No output yet. Open a JavaScript, Python or C++ file and press Run — the program executes in an isolated
            sandbox and its output appears here.
          </p>
        )}
        {phase === "running" && (
          <p role="status" className="text-zinc-500 dark:text-zinc-400">
            Running{entryFileName ? ` ${entryFileName}` : ""}… waiting for the execution service.
          </p>
        )}
        {phase === "error" && (
          <p role="alert" data-testid="execution-error" className="rounded bg-red-50 px-2 py-1.5 text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        {phase === "disabled" && (
          <p
            role="status"
            data-testid="execution-disabled"
            className="rounded bg-sky-50 px-2 py-1.5 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
          >
            {error ?? "Code execution is not enabled on this deployment"} Editing, collaboration, chat and version
            history are unaffected — only running code is turned off on this deployment.
          </p>
        )}
        {phase === "done" && cancelledByUser && !execution && (
          <p data-testid="execution-cancelled" className="text-zinc-500 dark:text-zinc-400">
            Execution cancelled — the run was stopped and no output was captured.
          </p>
        )}
        {execution && (
          <>
            {execution.stdout ? (
              <pre data-testid="execution-stdout" className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-200">{execution.stdout}</pre>
            ) : (
              <p className="text-zinc-400 dark:text-zinc-500">(no stdout)</p>
            )}
            {execution.stderr ? (
              <pre
                data-testid="execution-stderr"
                className="mt-2 whitespace-pre-wrap break-words rounded bg-red-50 px-2 py-1.5 text-red-700 dark:bg-red-950/60 dark:text-red-300"
              >
                {execution.stderr}
              </pre>
            ) : null}
          </>
        )}
      </div>

      {execution && (
        <div
          data-testid="execution-footer"
          className="shrink-0 border-t border-zinc-100 px-3 py-1.5 font-mono text-[11px] text-zinc-500 dark:border-zinc-900 dark:text-zinc-400"
        >
          Exit code {execution.exitCode ?? "—"} · Duration {execution.executionTimeMs ?? "—"} ms · Status {execution.status}
        </div>
      )}
    </div>
  );
}
