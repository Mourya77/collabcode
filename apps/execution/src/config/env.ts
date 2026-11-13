import { z } from "zod";

/**
 * Environment for @collabcode/execution.
 *
 * Security-relevant settings:
 * - EXECUTION_INTERNAL_TOKEN: shared secret between the public API and this
 *   service. The service is internal-only; every route except GET /health
 *   requires it. A dev default exists for local development and is REJECTED
 *   when NODE_ENV=production.
 * - EXECUTION_RUNNER: "docker" (production default — real container
 *   isolation) or "subprocess" (DEV/TEST ONLY — runs code on the host with
 *   no isolation; selecting it while NODE_ENV=production crashes the boot).
 */
export const DEV_INTERNAL_TOKEN = "<MASKED_SECRET_002>";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4002),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  EXECUTION_INTERNAL_TOKEN: z.string().min(16).default(DEV_INTERNAL_TOKEN),
  EXECUTION_RUNNER: z.enum(["docker", "subprocess"]).default("docker"),
  /** Default per-job wall-clock budget; the hard maximum is 30s. */
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(10_000),
  EXECUTION_MEMORY_MB: z.coerce.number().int().positive().default(256),
  EXECUTION_MAX_OUTPUT_KB: z.coerce.number().int().positive().default(64),
  EXECUTION_MAX_CONCURRENT: z.coerce.number().int().positive().default(4),
  /** Parent directory for the per-job temporary workspaces. */
  EXECUTION_WORKSPACES_DIR: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    throw new Error(
      `Invalid environment variables for @collabcode/execution: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const env = r.data;
  if (env.NODE_ENV === "production" && env.EXECUTION_INTERNAL_TOKEN === DEV_INTERNAL_TOKEN) {
    throw new Error(
      "EXECUTION_INTERNAL_TOKEN must be set to a real secret in production (the built-in dev default is rejected).",
    );
  }
  if (env.NODE_ENV === "production" && env.EXECUTION_RUNNER === "subprocess") {
    throw new Error(
      "EXECUTION_RUNNER=subprocess is forbidden in production: it executes untrusted code on the host " +
        "with NO container isolation. Use EXECUTION_RUNNER=docker on an isolated Docker host.",
    );
  }
  return env;
}

export const env: Env = loadEnv();
