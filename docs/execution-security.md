# Execution security model

The security posture for CollabCode's code execution: what untrusted code
is allowed to touch, how the boundary is enforced, why the public
deployment ships with execution **disabled**, and the checklist that must
pass on a real Docker host before that changes.

Mechanics (lifecycle, runners, limits) live in [execution.md](execution.md);
this document is the security argument.

## The rule

> **Never deploy untrusted code execution on an ordinary shared web
> service without verified isolation.**

Concretely, for the Phase 8 public deployment (Render + Vercel):

- The execution service is **not deployed at all**.
- The API is deployed **without** `EXECUTION_SERVICE_URL`. In production
  that puts the API in execution-disabled mode: `POST /executions`
  returns `503 {"code": "EXECUTION_DISABLED", "message": "Code execution
  is not enabled on this deployment"}`, creates **no** execution record,
  and the web UI renders that as a calm notice in the Output panel — not
  an error, and never a fake result.
- Everything else (editing, collaboration, chat, versions, restore) is
  unaffected.

## Threat model

Submitted code is treated as hostile. It may try to: read host files or
environment (secrets!), reach the network (SSRF, exfiltration, mining),
fork-bomb, exhaust memory/CPU/disk, escape to the host, or persist beyond
its run. The API and collaboration processes must never execute it — only
the dedicated execution service does, and in production only inside a
throwaway container.

## Defence in depth

| Layer | Control |
|---|---|
| Placement | Separate service on its own host; internal-only — every route except `GET /health` requires `x-internal-token` (timing-safe compare). The public API is its only caller; browsers can never reach it |
| API gate | Cookie auth + CSRF + project role ≥ EDITOR (VIEWER 403, non-member 404); rate limit 30 runs/hour/user; max 2 in flight per user; execution records are creator-only (404 for everyone else) |
| No client control | Language derived server-side from the entry file's extension; file paths from DB rows; **no** image names, Docker options or runner settings can cross the API |
| Validation (both hops) | Relative paths only, no `..`, no duplicates; entry point must be in the file set; ≤50 files, ≤1 MiB total, ≤64 KiB stdin |
| Container | One `docker run` per step with the flag set below; fixed images only (`node:20-alpine`, `python:3.12-alpine`, `gcc:13-bookworm`) |
| Output | stdout/stderr capped at 64 KiB each with a truncation marker — a run cannot flood the API, the DB, or the browser |
| Failure honesty | Service down → recorded `FAILED` with an explanatory stderr; Docker binary missing → `FAILED`, **never** a silent fallback to the un-isolated runner |
| Boot guards | `EXECUTION_RUNNER=subprocess` + `NODE_ENV=production` crashes the execution service at boot; dev token defaults are rejected in production on the service AND the API |

## What each Docker flag defeats

| Flag | Defeats |
|---|---|
| `--network none` | SSRF, data exfiltration, crypto-mining pools, downloading tooling |
| `--memory 256m --memory-swap 256m` | Memory exhaustion of the host; swap escape around the cap |
| `--cpus 0.5` | CPU starvation of co-located work |
| `--pids-limit 64` | Fork bombs |
| `--user 1000:1000` | Root-owned damage inside the container; root-owned files in the workspace mount |
| `--cap-drop ALL` | Capability-based privilege escalation |
| `--security-opt no-new-privileges` | setuid/setgid escalation paths |
| `--read-only` + `--tmpfs /tmp:rw,size=32m` | Tampering with the image; disk filling outside the workspace |
| `--ulimit core=0` | Core-dump disk filling / memory disclosure via dumps |
| `-v <job workspace>:/workspace:rw` (only mount) | Host file access — the job sees exactly its own files, nothing else; no Docker socket is ever mounted |
| `--rm` + unconditional `docker kill`/`rm -f` + workspace delete in a `finally` | Persistence beyond the run, container/workspace leaks |

## The subprocess runner — dev/test only, NOT a sandbox

`SubprocessRunner` executes `node`/`python3`/`g++` directly on the host
(process-group kill on timeout/cancel, RSS-polling memory enforcement).
It exists so the full pipeline can be developed and tested on machines
without Docker. **It provides no isolation**: code runs with the service
process's privileges. It must never be reachable in production — the boot
guard above enforces that, and this is the second reason (after the
unverified Docker path) that the public deployment ships execution
disabled rather than "temporarily" using this runner.

## Verification status

- ✅ Unit-pinned: the exact `docker run` argv from `buildDockerArgs()`
  (every flag above, fixed images) is asserted by the execution suite.
- ✅ Live-verified via the subprocess runner: JS/Python/C++ runs, compile
  and runtime errors, timeout kill, memory-hog kill, cancellation, output
  truncation, workspace cleanup, creator-only access, role gates.
- ❌ **NOT live-verified: the DockerRunner against a real daemon.** The
  authoring sandbox has no Docker. Container cleanup, memory/CPU
  enforcement and network isolation under Docker are therefore
  **unproven** until the checklist below is run on a Docker host.

## Docker-host verification checklist (required before enabling)

Run on the intended execution host, with `EXECUTION_RUNNER=docker`:

1. `docker` CLI present; the service's `GET /health` is ok and a JS hello
   world returns `COMPLETED` through the public API.
2. A program that tries `fetch('http://example.com')` / opens a socket
   **fails** (no network).
3. A program that reads `/etc/passwd` succeeds only for the container's
   own file; reading `/workspace/../` or any host path **fails**; the
   process runs as uid 1000 (`id` inside a run).
4. A memory hog (>256 MB) is killed and the host stays responsive;
   `docker stats` during a CPU hog shows the 0.5 CPU cap.
5. A fork bomb is contained (pids limit) and the run ends `FAILED`/`TIMEOUT`.
6. An infinite loop ends `TIMEOUT` at the configured budget; a cancel
   mid-run ends `CANCELLED` promptly.
7. After all of the above: `docker ps -a` shows **no** leftover
   `cc-exec-*` containers and the workspaces directory is empty.
8. From the internet: the execution service's port is **unreachable**;
   only the API can call it, and calls without the internal token get 401.

Only after every item passes: set `EXECUTION_SERVICE_URL` +
`EXECUTION_INTERNAL_TOKEN` (matching) on the API and redeploy it.
