import { execFile } from "node:child_process";
import { getLanguage, type RunStep } from "../languages.js";
import { startProcess, type RunningProcess } from "./process.js";
import { runSteps } from "./runSteps.js";
import { createWorkspace, cleanupWorkspace } from "./workspace.js";
import type { ExecuteJob, RunResult, Runner, RunnerHooks } from "./types.js";

/**
 * Production runner: every job step runs in a disposable Docker container
 * with strict isolation (see buildDockerArgs for the flag-by-flag contract,
 * and docs/execution.md for the rationale). The Docker daemon is only ever
 * reached from THIS service on the isolated execution host — never from the
 * public API, and clients can never influence images, flags or mounts.
 *
 * NOTE: implemented and unit-tested, but NOT live-verified in the authoring
 * sandbox, which has no Docker daemon. Verify on a Docker host before any
 * public deployment (docs/execution.md has the checklist).
 */

/**
 * Builds the `docker run` argv for one step of a job. Pure and unit-tested:
 * every security flag lives here and nowhere else.
 */
export function buildDockerArgs(
  job: ExecuteJob,
  workspaceDir: string,
  containerName: string,
  step: RunStep = getLanguage(job.language).steps(job.entryPoint)[0] as RunStep,
  memoryMb = 256,
): string[] {
  const language = getLanguage(job.language);
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "-i",
    // No network access of any kind.
    "--network",
    "none",
    // Hard resource ceilings; memory-swap == memory disables swap headroom.
    "--memory",
    `${memoryMb}m`,
    "--memory-swap",
    `${memoryMb}m`,
    "--cpus",
    "0.5",
    "--pids-limit",
    "64",
    // Never root, never privileged, no capabilities, no privilege escalation.
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    // Immutable image filesystem; only the job workspace (mounted) and a
    // small tmpfs /tmp (the C++ binary lives in the workspace) are writable.
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=32m",
    "--ulimit",
    "core=0",
    // Exactly one mount: this job's temporary workspace. No host paths, no
    // Docker socket, nothing else.
    "-v",
    `${workspaceDir}:/workspace:rw`,
    "-w",
    "/workspace",
    language.dockerImage,
    ...step.argv,
  ];
}

function dockerKill(containerName: string): void {
  execFile("docker", ["kill", containerName], () => undefined);
  execFile("docker", ["rm", "-f", containerName], () => undefined);
}

export class DockerRunner implements Runner {
  readonly kind = "docker" as const;

  constructor(
    private readonly opts: {
      memoryMb: number;
      maxOutputBytes: number;
      workspacesDir?: string;
    },
  ) {}

  async run(job: ExecuteJob, hooks: RunnerHooks): Promise<RunResult> {
    const workspace = await createWorkspace(job.files, this.opts.workspacesDir);
    const containerNames: string[] = [];
    try {
      return await runSteps(job, hooks, {
        startStep: (step, ctx) => {
          const containerName = `cc-exec-${job.executionId}-${step.phase}`;
          containerNames.push(containerName);
          const proc: RunningProcess = startProcess(
            {
              command: "docker",
              args: buildDockerArgs(job, workspace, containerName, step, this.opts.memoryMb),
              cwd: workspace,
              stdin: ctx.stdin,
              deadlineMs: ctx.deadlineMs,
            },
            this.opts.maxOutputBytes,
          );
          // Terminating a step must kill the CONTAINER, not just the CLI.
          const cliKill = proc.kill;
          proc.kill = (reason) => {
            dockerKill(containerName);
            cliKill(reason);
          };
          return proc;
        },
        describeSpawnError: (_err, _step) =>
          "\n[execution] Docker runner unavailable: the `docker` binary/daemon was not reachable on the " +
          "execution host, so the job could not be started. The job was NOT run anywhere else instead.",
        memoryNote: () => `\n[execution] Memory limit of ${this.opts.memoryMb} MB exceeded; the container was killed.`,
      });
    } finally {
      // Belt and braces: no container or workspace outlives the job.
      for (const name of containerNames) dockerKill(name);
      await cleanupWorkspace(workspace);
    }
  }
}
