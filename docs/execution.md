# Code execution (Phase 5)

How CollabCode runs user code: architecture, the security model, the two
runners, every limit, and what is — and is not — verified.

> **⚠ Do not expose the execution service publicly until the Docker runner
> has been verified on a real Docker host.** In the development sandbox
> used to build Phase 5 there is **no Docker daemon**, so the Docker runner
> is implemented and unit-tested (its exact `docker run` argv is pinned by
> tests) but **not live-verified**. All live verification in this
> environment used the **subprocess runner, which provides NO isolation**
> and exists for development/tests only. See "Verification status" below.

## Architecture

```
Browser ──► API (apps/api, :4000) ──► Execution service (apps/execution, :4002)
              │  POST /api/projects/:id/executions        │  POST /execute (internal token)
              │  GET  /api/executions/:id                 │  POST /execute/:id/cancel
              │  POST /api/executions/:id/cancel          │  GET  /health (public)
              ▼                                           ▼
        PostgreSQL (Execution rows)              Runner adapter
                                                 ├─ DockerRunner (production)
                                                 └─ SubprocessRunner (dev/test only)
```

Rules that shape the design:

- **User code never executes in the API or collaboration processes.** The
  API only validates, persists, and proxies; the dedicated execution
  service runs code, and in production each run is a throwaway Docker
  container.
- **The execution service is internal-only.** Every route except
  `GET /health` requires the header `x-internal-token` to match
  `EXECUTION_INTERNAL_TOKEN` (timing-safe comparison; 401 otherwise). The
  public API is its only caller; browsers never reach it.
- **Clients can never influence how code runs.** No image names, no Docker
  options, no language field, no filesystem paths cross the API: the
  language is derived server-side from the entry file's extension, paths
  come from the project's `File` rows, and contents come from the caller's
  live editor state (for files they submit) or the latest saved
  `DocumentVersion`.

## Request lifecycle

1. `POST /api/projects/:projectId/executions` — auth + CSRF +
   project role ≥ EDITOR (VIEWER → 403, non-member → 404). Body:
   `{ entryFileId, files?: [{ fileId, content? }] }`.
2. The API resolves the file set (submitted files, else all project files,
   cap 50; the entry file is always included), derives the language from
   the entry extension (`.js/.mjs/.cjs` → javascript, `.py` → python,
   `.cpp/.cc/.cxx` → cpp; anything else → 400 `UNSUPPORTED_LANGUAGE`), and
   creates an `Execution` row (QUEUED → RUNNING).
3. The API calls `POST /execute` on the execution service and **blocks**
   until the run finishes (bounded by the service timeout, ≤ 30 s). The
   final status/stdout/stderr/exitCode/duration are persisted and the DTO
   returned (201).
4. If the service is unreachable, the execution is recorded `FAILED` with
   stderr `Execution service unavailable: …` — an honest failure, never a
   fabricated result.
5. **Cancellation.** `POST /api/executions/:id/cancel` (creator only)
   marks the row `CANCELLED`, aborts the in-flight service request, and
   notifies the service. Because the create call blocks, the web UI cancels
   by aborting its fetch; the API treats a client disconnect mid-run as a
   cancellation too. The execution service also kills a job if its HTTP
   client disconnects. Cancelling a terminal execution → 409
   `EXECUTION_NOT_RUNNING`.
6. **Ownership.** Executions are creator-scoped: `GET /api/executions/:id`
   and cancel return 404 for anyone but the user who created the run —
   including other project members.

States: `QUEUED → RUNNING → COMPLETED | FAILED | TIMEOUT | CANCELLED`
(`CANCELLED` added in Phase 5, migration `20261112134943_phase5_execution_cancelled`).

## Runners

Both runners share one contract (`src/runners/types.ts`): write the job's
files into a fresh temp workspace, run the language adapter's steps
(compile step for C++, then the run step), enforce the deadline and the
output caps, and **always** delete the workspace afterwards.

Language adapters (`src/languages.ts`) are the single source of truth:

| Language   | Docker image        | Steps                                             |
| ---------- | ------------------- | ------------------------------------------------- |
| javascript | `node:20-alpine`    | `node <entry>`                                    |
| python     | `python:3.12-alpine`| `python3 <entry>`                                 |
| cpp        | `gcc:13-bookworm`   | `g++ -O2 -std=c++17 -o .build/app <entry>`, then `.build/app` |

### DockerRunner (production default, `EXECUTION_RUNNER=docker`)

One `docker run` per step, built by the pure, unit-tested
`buildDockerArgs()`:

```
docker run --rm --name cc-exec-<executionId>-<phase>
  -i                                   # stdin is piped to the program
  --network none                       # no network at all
  --memory 256m --memory-swap 256m     # hard memory cap, no swap escape
  --cpus 0.5                           # half a CPU
  --pids-limit 64                      # fork-bomb containment
  --user 1000:1000                     # never root
  --cap-drop ALL                       # no Linux capabilities
  --security-opt no-new-privileges     # no setuid escalation
  --read-only                          # image filesystem is immutable
  --tmpfs /tmp:rw,size=32m             # small scratch space
  --ulimit core=0                      # no core dumps
  -v <workspace>:/workspace:rw         # the ONLY mount: the job's own files
  -w /workspace
  <fixed image> <step argv>
```

Cleanup is unconditional: a `finally` runs `docker kill` + `docker rm -f`
for every container the job created and deletes the workspace. Timeout →
`docker kill`. If the `docker` binary is missing at runtime, the job fails
with `FAILED` and stderr explaining the runner is unavailable — the
service **never silently falls back** to the subprocess runner.

### SubprocessRunner (DEV/TEST ONLY — no isolation)

Runs `node` / `python3` / `g++` directly on the host with the same
file/deadline/output contract: detached process group (timeout/cancel
kills the whole group with SIGKILL), stdin piped, minimal child
environment, and memory enforced by polling the process group's RSS
(/proc) against `EXECUTION_MEMORY_MB` — `ulimit -v` is deliberately not
used because V8's virtual-memory reservations break Node under it.

**This runner executes user code with the service process's own
privileges. It is not a sandbox.** Guards: selecting
`EXECUTION_RUNNER=subprocess` while `NODE_ENV=production` crashes the
service at boot; the dev internal-token default is likewise rejected in
production (on both the service and the API).

## Limits (defaults)

| Limit                                   | Value / env                                   |
| --------------------------------------- | --------------------------------------------- |
| Per-run wall clock                      | 10 s default, 30 s max (`EXECUTION_TIMEOUT_MS`) |
| Memory per run                          | 256 MB (`EXECUTION_MEMORY_MB`)                |
| stdout / stderr capture                 | 64 KiB each, truncated with a marker (`EXECUTION_MAX_OUTPUT_KB`) |
| Files per run / total size              | 50 files / 1 MiB (enforced on both API and service) |
| stdin                                   | 64 KiB                                        |
| Concurrent jobs on the service          | 4 (`EXECUTION_MAX_CONCURRENT`; excess → 429 `EXECUTION_BUSY`, which the API records as a FAILED run with an explanatory stderr) |
| Execution creation rate (API)           | 30 / hour / user (`EXECUTION_RATE_LIMIT_MAX`) |
| In-flight executions per user (API)     | 2 → 429 `TOO_MANY_RUNNING`                    |
| Docker only: CPUs / pids / tmpfs        | 0.5 / 64 / 32 MB                              |

File paths are validated on both hops: relative, `/`-separated, no `..`,
no absolute paths, no duplicates; the entry point must be one of the
submitted files.

## Frontend behaviour

The workspace **Run** button (EDITOR+) submits the active file as the
entry point plus all project files — live editor (Yjs) content for files
open in the editor, latest saved version otherwise. While running, the
header shows an elapsed timer and a **Cancel** button (which aborts the
request; see lifecycle step 5). Results land in the **Output** tab:
stdout, stderr (red, only when non-empty), and a footer
`Exit code N · Duration X ms · Status`. VIEWERs see Run disabled
("View-only"). An unsupported entry file surfaces the API's 400 message
as an error state in the panel.

The Output panel is **captured program output, not an interactive
terminal** — it is labelled as such. The Terminal tab remains an honest
"interactive shell not connected" placeholder; CollabCode has no
interactive shell feature.

## Verification status (2026-11-12)

- Execution service suite (25 tests): Docker argv contract (every flag,
  fixed images), env guards, internal-token auth, validation, and — via
  the subprocess runner against real node/python3/g++ — JS/Python/C++
  hello-world, C++ compile error (phase `compile`), JS runtime error,
  stdin, multi-file runs, timeout kill, memory-hog kill, cancel, output
  truncation, workspace cleanup.
- API suite (+9 Phase 5 tests, real PostgreSQL + the real execution
  service as a child process): end-to-end runs in all three languages,
  live-content override, VIEWER 403 / non-member 404, creator-only reads,
  unsupported language 400, timeout through the stack, prompt cancel →
  `CANCELLED`, service-down → honest `FAILED`.
- Web suite (+10 Phase 5 tests): store run/error/cancel, Output panel
  rendering, workspace Run wiring, VIEWER gate.
- Live smoke (this sandbox): API + execution service (subprocess runner)
  booted together; JS/Python/C++ files created and run through the public
  API; infinite loop → TIMEOUT; sleep cancelled → CANCELLED; no leftover
  workspace directories.
- **Not verified:** the Docker runner against a live daemon (none exists
  in this sandbox), Docker-based memory/CPU enforcement, and container
  cleanup under Docker. Those are pinned by argv unit tests only and must
  be verified on a Docker host before any public deployment.
