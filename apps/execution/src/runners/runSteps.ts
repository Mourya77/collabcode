import { getLanguage, type RunStep } from "../languages.js";
import type { RunningProcess } from "./process.js";
import type { ExecuteJob, RunResult, RunnerHooks, TerminationReason } from "./types.js";

/**
 * Shared step engine for both runners: walks the language's steps
 * (compile → run) against one workspace, merges capped output, tracks the
 * overall job deadline, and maps process outcomes onto the result contract.
 * Runners differ only in how a step is spawned (host binary vs docker run).
 */
export interface StepEngineOptions {
  startStep: (step: RunStep, ctx: { stdin?: string; deadlineMs: number }) => RunningProcess;
  /** Renders a spawn failure (binary missing) into result stderr. */
  describeSpawnError: (err: Error, step: RunStep) => string;
  /** Extra stderr line appended when the memory ceiling kills a step. */
  memoryNote: (step: RunStep) => string;
}

export async function runSteps(job: ExecuteJob, hooks: RunnerHooks, opts: StepEngineOptions): Promise<RunResult> {
  const startedAt = Date.now();
  const steps = getLanguage(job.language).steps(job.entryPoint);

  let current: RunningProcess | null = null;
  let externalReason: TerminationReason | undefined;
  hooks.registerKill((reason) => {
    externalReason ??= reason;
    current?.kill(reason);
  });

  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const finish = (partial: Omit<RunResult, "durationMs" | "stdout" | "stderr"> & { stderrExtra?: string }): RunResult => ({
    ...partial,
    stdout: stdoutParts.join(""),
    stderr: stderrParts.join("") + (partial.stderrExtra ?? ""),
    durationMs: Date.now() - startedAt,
  });

  for (const step of steps) {
    const remaining = job.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      return finish({ status: "TIMEOUT", exitCode: null, phase: step.phase, terminationReason: "timeout" });
    }
    const proc = opts.startStep(step, {
      stdin: step.phase === "run" ? job.stdin : undefined,
      deadlineMs: remaining,
    });
    current = proc;
    const outcome = await proc.promise;
    current = null;
    stdoutParts.push(proc.stdout.toString());
    stderrParts.push(proc.stderr.toString());

    if (outcome.spawnError) {
      return finish({
        status: "FAILED",
        exitCode: null,
        phase: step.phase,
        stderrExtra: opts.describeSpawnError(outcome.spawnError, step),
      });
    }
    if (outcome.timedOut) {
      return finish({
        status: "TIMEOUT",
        exitCode: null,
        phase: step.phase,
        terminationReason: "timeout",
        stderrExtra: `\n[execution] Timed out after ${job.timeoutMs} ms and was killed.`,
      });
    }
    if (outcome.killReason === "cancel" || outcome.killReason === "client-disconnect") {
      return finish({
        status: "TIMEOUT",
        exitCode: null,
        phase: step.phase,
        terminationReason: outcome.killReason,
        stderrExtra: `\n[execution] Killed (${outcome.killReason === "cancel" ? "cancelled by request" : "client disconnected"}).`,
      });
    }
    if (outcome.memoryExceeded) {
      return finish({
        status: "FAILED",
        exitCode: null,
        phase: step.phase,
        terminationReason: "memory",
        stderrExtra: opts.memoryNote(step),
      });
    }
    if (outcome.exitCode !== 0) {
      return finish({ status: "FAILED", exitCode: outcome.exitCode, phase: step.phase });
    }
    // A kill that raced with a clean exit still wins if it arrived first.
    if (externalReason === "cancel" || externalReason === "client-disconnect") {
      return finish({ status: "TIMEOUT", exitCode: null, phase: step.phase, terminationReason: externalReason });
    }
  }

  return finish({ status: "COMPLETED", exitCode: 0 });
}
