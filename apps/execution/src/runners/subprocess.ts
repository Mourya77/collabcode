import { startProcess } from "./process.js";
import { runSteps } from "./runSteps.js";
import { createWorkspace, cleanupWorkspace } from "./workspace.js";
import type { ExecuteJob, RunResult, Runner, RunnerHooks } from "./types.js";

/**
 * ⚠️ DEV/TEST-ONLY RUNNER — NO ISOLATION. ⚠️
 *
 * Executes untrusted code as host processes on the machine running this
 * service. It applies the same workspace/timeout/output contract as the
 * Docker runner and adds best-effort limits (own process group, group RSS
 * ceiling enforced by polling /proc, minimal environment, hard wall-clock
 * kill), but there is NO filesystem, network or syscall isolation: submitted
 * code can read anything this process can read.
 *
 * It exists so the execution pipeline can be developed and tested on
 * machines without Docker. It must NEVER be used for a public deployment —
 * the service refuses to boot with EXECUTION_RUNNER=subprocess when
 * NODE_ENV=production (see config/env.ts). Production uses DockerRunner.
 */
export class SubprocessRunner implements Runner {
  readonly kind = "subprocess" as const;

  constructor(
    private readonly opts: {
      memoryMb: number;
      maxOutputBytes: number;
      workspacesDir?: string;
    },
  ) {}

  async run(job: ExecuteJob, hooks: RunnerHooks): Promise<RunResult> {
    const workspace = await createWorkspace(job.files, this.opts.workspacesDir);
    try {
      return await runSteps(job, hooks, {
        startStep: (step, ctx) =>
          startProcess(
            {
              command: step.argv[0] as string,
              args: step.argv.slice(1),
              cwd: workspace,
              stdin: ctx.stdin,
              deadlineMs: ctx.deadlineMs,
              memoryLimitMb: this.opts.memoryMb,
              // Minimal environment: no inherited secrets, just what the
              // interpreters need to find themselves and their locales.
              env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
            },
            this.opts.maxOutputBytes,
          ),
        describeSpawnError: (err, step) =>
          `\n[execution] Could not start "${step.argv[0]}" on the execution host: ${err.message}. ` +
          "The subprocess runner needs node, python3 and g++ installed locally.",
        memoryNote: () => `\n[execution] Memory limit of ${this.opts.memoryMb} MB exceeded; the process was killed.`,
      });
    } finally {
      await cleanupWorkspace(workspace);
    }
  }
}
