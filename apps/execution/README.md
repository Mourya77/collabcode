# @collabcode/execution

Internal-only code execution service (port 4002), real since Phase 5.
Full architecture, security model, limits and verification status:
**`../../docs/execution.md`**.

> **⚠ Do not expose this service publicly until the Docker runner has been
> verified on a real Docker host.** The sandbox used to build Phase 5 has
> no Docker daemon: the Docker runner is implemented and unit-tested
> (argv contract) but not live-verified. The subprocess runner used for
> local verification provides **NO isolation**.

## API (internal — never public)

Every route except `GET /health` requires header
`x-internal-token: <EXECUTION_INTERNAL_TOKEN>` (401 otherwise). The public
API (apps/api) is the only caller.

| Route | Behaviour |
|---|---|
| `GET /health` | `{status, service, runner, activeJobs, …}` — public |
| `POST /execute` | `{executionId, language, files:[{path,content}], entryPoint, stdin?, timeoutMs?}` → blocks until the run finishes: `{executionId, status: COMPLETED\|FAILED\|TIMEOUT, stdout, stderr, exitCode, durationMs, phase?, terminationReason?}`. Output capped at 64 KiB/stream. If the client disconnects mid-run, the job is killed |
| `POST /execute/:executionId/cancel` | Kills the in-flight job → `{cancelled: true}`; 404 when not running |

Validation: language allowlist (`javascript` | `python` | `cpp` — clients
can never supply image names or runner options), safe relative file
paths, ≤ 50 files, ≤ 1 MiB total, entry point must be one of the files.

## Runners (`EXECUTION_RUNNER`)

- **`docker` (default, production)** — one hardened `docker run` per step:
  `--network none`, `--memory/--memory-swap 256m`, `--cpus 0.5`,
  `--pids-limit 64`, `--user 1000:1000`, `--cap-drop ALL`,
  `no-new-privileges`, `--read-only`, tmpfs `/tmp` 32 MB, workspace as the
  only mount, fixed images (`node:20-alpine`, `python:3.12-alpine`,
  `gcc:13-bookworm`). Containers and workspaces are always cleaned up. A
  missing docker binary fails the job honestly — never a silent fallback.
- **`subprocess` (DEV/TEST ONLY)** — runs `node`/`python3`/`g++` on the
  host with process-group kills and RSS-polling memory enforcement.
  **Not isolated. Never production:** the service refuses to boot with it
  when `NODE_ENV=production`.

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | `4002` | |
| `EXECUTION_INTERNAL_TOKEN` | dev default | Shared with apps/api; the dev default is rejected when `NODE_ENV=production` |
| `EXECUTION_RUNNER` | `docker` | `docker` \| `subprocess` (see above) |
| `EXECUTION_TIMEOUT_MS` | `10000` | Per-run cap; job-level `timeoutMs` may lower it (max 30000) |
| `EXECUTION_MEMORY_MB` | `256` | Docker `--memory` / subprocess RSS cap |
| `EXECUTION_MAX_OUTPUT_KB` | `64` | Per-stream capture cap |
| `EXECUTION_MAX_CONCURRENT` | `4` | Excess `POST /execute` → 429 `EXECUTION_BUSY` |
| `EXECUTION_WORKSPACES_DIR` | `os.tmpdir()` | Per-job temp workspaces are created and always deleted |

## Run

```bash
pnpm --filter @collabcode/execution dev    # tsx watch on :4002
pnpm --filter @collabcode/execution test   # vitest (argv contract + real runs via subprocess runner)
```
