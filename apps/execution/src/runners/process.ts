import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { OutputCollector, type TerminationReason } from "./types.js";

export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  /** Remaining wall-clock budget for this process, ms. */
  deadlineMs: number;
  /**
   * Optional RSS ceiling (MiB) enforced by polling the child's process
   * GROUP via /proc. Only meaningful for host processes (subprocess runner);
   * the Docker runner enforces memory inside the container instead.
   */
  memoryLimitMb?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  memoryExceeded: boolean;
  /** Termination reason when the process was killed externally. */
  killReason?: TerminationReason;
  /** Set when the binary could not be spawned at all (e.g. ENOENT). */
  spawnError?: Error;
}

export interface RunningProcess {
  promise: Promise<ProcessOutcome>;
  kill: (reason: TerminationReason) => void;
  stdout: OutputCollector;
  stderr: OutputCollector;
}

const PAGE_BYTES = 4096;

/** Sums RSS (bytes) over every process in the given process group, via /proc. */
function groupRssBytes(pgid: number): number {
  let totalPages = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      // comm (field 2) may contain spaces/parens — parse after the last ")".
      const tail = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const pgrp = Number(tail[2]); // field 5 overall
      const rssPages = Number(tail[21]); // field 24 overall
      if (pgrp === pgid && Number.isFinite(rssPages)) totalPages += rssPages;
    } catch {
      // Process vanished mid-scan — ignore.
    }
  }
  return totalPages * PAGE_BYTES;
}

/**
 * Starts one child process in its OWN process group (detached), captures
 * capped stdout/stderr, feeds stdin, and guarantees termination on deadline,
 * memory excess, or an external kill(). All kills target the whole group so
 * grandchildren (compilers, shells) cannot escape.
 */
export function startProcess(spec: ProcessSpec, outputCapBytes: number): RunningProcess {
  const stdout = new OutputCollector(outputCapBytes);
  const stderr = new OutputCollector(outputCapBytes);
  let child: ChildProcess | null = null;
  let killReason: TerminationReason | undefined;
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  let poller: NodeJS.Timeout | null = null;

  const kill = (reason: TerminationReason): void => {
    if (!child || settled) return;
    killReason ??= reason;
    const pid = child.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  };

  const promise = new Promise<ProcessOutcome>((resolve) => {
    const finish = (outcome: ProcessOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (poller) clearInterval(poller);
      resolve(outcome);
    };

    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        detached: true,
        env: spec.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      finish({ exitCode: null, signal: null, timedOut: false, memoryExceeded: false, spawnError: e as Error });
      return;
    }

    child.on("error", (err) => {
      finish({ exitCode: null, signal: null, timedOut: false, memoryExceeded: false, spawnError: err });
    });
    child.stdout?.on("data", (d: Buffer) => stdout.append(d));
    child.stderr?.on("data", (d: Buffer) => stderr.append(d));
    child.stdin?.on("error", () => undefined); // EPIPE when the child exits early
    try {
      child.stdin?.write(spec.stdin ?? "");
      child.stdin?.end();
    } catch {
      /* child already gone */
    }

    timer = setTimeout(() => kill("timeout"), Math.max(1, spec.deadlineMs));
    timer.unref?.();

    if (spec.memoryLimitMb && child.pid) {
      const limitBytes = spec.memoryLimitMb * 1024 * 1024;
      const pgid = child.pid;
      poller = setInterval(() => {
        if (groupRssBytes(pgid) > limitBytes) kill("memory");
      }, 50);
      poller.unref?.();
    }

    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        timedOut: killReason === "timeout",
        memoryExceeded: killReason === "memory",
        killReason,
      });
    });
  });

  return { promise, kill, stdout, stderr };
}
