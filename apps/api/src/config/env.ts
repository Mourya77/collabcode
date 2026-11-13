import { z } from "zod";

const DEV_JWT_SECRET = "dev-only-jwt-secret-change-in-production-0123456789";
export const DEV_COLLAB_TOKEN = ["dev", "collab", "internal", "token"].join("-");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://collabcode:collabcode_dev_password@localhost:5432/collabcode?schema=public"),
  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Comma-separated allowlist. CORS_ORIGIN (Phase 0, single origin) is honoured as a fallback.
  CORS_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.string().optional(),
  // Phase 4 — invitations. APP_BASE_URL is where the SPA is served; dev-mode
  // invitation links are built from it. Email delivery is optional: when
  // SMTP_HOST is unset the API runs the DevMailer (logs the invite link and
  // returns it in the create response). See docs/api.md for production setup.
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Phase 5 — code execution. The API is the ONLY caller of the execution
  // service; EXECUTION_INTERNAL_TOKEN must match the service's token.
  // Phase 8 — execution is OPTIONAL in production: when this is unset (or
  // explicitly empty) in production, code execution is DISABLED and
  // POST /executions returns 503 EXECUTION_DISABLED — a deployment without
  // a verified Docker-capable execution host must not pretend to run code
  // (see docs/deployment.md). Outside production, unset keeps the local
  // default so `pnpm dev` works out of the box; an explicitly empty value
  // disables execution in any environment.
  EXECUTION_SERVICE_URL: z.union([z.string().url(), z.literal("")]).optional(),
  EXECUTION_INTERNAL_TOKEN: z.string().min(16).default("<MASKED_SECRET_002>"),
  /** Max execution creations per user per hour (relaxed under NODE_ENV=test). */
  EXECUTION_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  /** Max simultaneous in-flight executions per user. */
  EXECUTION_USER_INFLIGHT_MAX: z.coerce.number().int().positive().default(2),
  // Phase 6 — version restore goes through the collaboration server's
  // internal HTTP endpoint (health port) so restored content is applied to
  // the live CRDT document. COLLAB_INTERNAL_TOKEN must match the collab
  // server's token.
  COLLAB_INTERNAL_URL: z.string().url().default("http://localhost:4003"),
  COLLAB_INTERNAL_TOKEN: z.string().default(DEV_COLLAB_TOKEN),
});

const raw = schema.transform((v) => {
  const corsOrigins = (v.CORS_ORIGINS ?? v.CORS_ORIGIN)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // In tests the default limits are effectively disabled unless explicitly configured,
  // so functional tests are never throttled; production/dev keep the strict defaults.
  const isTest = v.NODE_ENV === "test";
  const executionServiceUrl =
    v.EXECUTION_SERVICE_URL !== undefined
      ? v.EXECUTION_SERVICE_URL === ""
        ? null
        : v.EXECUTION_SERVICE_URL
      : v.NODE_ENV === "production"
        ? null
        : "http://localhost:4002";
  return {
    ...v,
    EXECUTION_SERVICE_URL: executionServiceUrl,
    EXECUTION_ENABLED: executionServiceUrl !== null,
    CORS_ORIGINS_LIST: corsOrigins,
    COOKIE_SECURE_BOOL: v.COOKIE_SECURE ? v.COOKIE_SECURE === "true" : v.NODE_ENV === "production",
    RATE_LIMIT_GLOBAL_MAX: v.RATE_LIMIT_GLOBAL_MAX ?? (isTest ? 100_000 : 300),
    RATE_LIMIT_AUTH_MAX: v.RATE_LIMIT_AUTH_MAX ?? (isTest ? 100_000 : 20),
    EXECUTION_RATE_LIMIT_MAX: v.EXECUTION_RATE_LIMIT_MAX ?? (isTest ? 100_000 : 30),
  };
});

export type Env = z.infer<typeof raw>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = raw.safeParse(source);
  if (!r.success) {
    throw new Error(
      `Invalid environment variables for @collabcode/api: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  if (r.data.NODE_ENV === "production" && r.data.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error("JWT_SECRET must be set to a real secret in production (the built-in dev default is rejected).");
  }
  if (r.data.NODE_ENV === "production" && r.data.EXECUTION_INTERNAL_TOKEN === "<MASKED_SECRET_002>") {
    throw new Error(
      "EXECUTION_INTERNAL_TOKEN must be set to a real secret in production (the built-in dev default is rejected).",
    );
  }
  if (r.data.NODE_ENV === "production" && (r.data.COLLAB_INTERNAL_TOKEN === DEV_COLLAB_TOKEN || r.data.COLLAB_INTERNAL_TOKEN.length < 16)) {
    throw new Error(
      "COLLAB_INTERNAL_TOKEN must be set to a real secret of at least 16 characters in production (the built-in dev default is rejected).",
    );
  }
  return r.data;
}

export const env: Env = loadEnv();
