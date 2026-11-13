import { z } from "zod";

/** Dev-only default for the internal-endpoint shared secret (rejected in production by loadEnv). */
export const DEV_COLLAB_INTERNAL_TOKEN = ["dev", "collab", "internal", "token"].join("-");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4001),
  HEALTH_PORT: z.coerce.number().int().positive().default(4003),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://collabcode:collabcode_dev_password@localhost:5432/collabcode?schema=public"),
  /** Preferred secret for verifying collab JWTs; falls back to JWT_SECRET (shared with the API). */
  COLLAB_JWT_SECRET: z.string().min(16).optional(),
  JWT_SECRET: z.string().min(16).optional(),
  /** Hocuspocus onStoreDocument debounce (ms): edits are batched, never written per keystroke. */
  STORE_DEBOUNCE_MS: z.coerce.number().int().min(0).default(2000),
  MAX_DEBOUNCE_MS: z.coerce.number().int().min(0).default(10_000),
  /** Minimum interval between DocumentVersion rows created from Yjs state (per file). */
  VERSION_SYNC_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),
  /**
   * Phase 6 — shared secret for the internal HTTP endpoints on the health
   * port (currently: document restore, called ONLY by the API). A dev
   * default is allowed outside production; production requires a real
   * secret of at least 16 characters (enforced in loadEnv below).
   */
  COLLAB_INTERNAL_TOKEN: z.string().default(DEV_COLLAB_INTERNAL_TOKEN),
  /** Phase 6 — persistence retry policy: attempts per store/fetch before a store is parked as pending. */
  COLLAB_STORE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  /** Phase 6 — how often the pending-store sweeper retries parked stores (ms). */
  COLLAB_STORE_SWEEP_MS: z.coerce.number().int().min(250).default(5000),
  /**
   * Phase 7 — browser origins allowed to open collaboration WebSockets
   * (cross-site WebSocket hijacking guard). Comma-separated; connections
   * without an Origin header (native clients, tests) are not affected.
   * Should mirror the API's CORS_ORIGINS.
   */
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  /**
   * Phase 8 — single-port mode: hosts like Render expose exactly ONE port
   * per service, so the WS listener must also serve /health and the
   * internal restore endpoint. Explicit "true"/"false" wins; when unset,
   * loadEnv derives it: production + an explicitly provided PORT (which is
   * how Render injects it) ⇒ single-port. Local dev keeps the separate
   * health port (4003).
   */
  SINGLE_PORT: z.enum(["true", "false"]).optional(),
});

const withDerived = schema.transform((v) => ({
  ...v,
  ALLOWED_ORIGINS_LIST: v.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
}));

export type Env = z.infer<typeof withDerived> & {
  /** Phase 8: derived in loadEnv (see SINGLE_PORT). */
  SINGLE_PORT_MODE: boolean;
};

/** The API's built-in development JWT secret — never acceptable in production, on either service. */
export const KNOWN_DEV_JWT_SECRET = ["dev-only-jwt-secret", "change-in-production", "0123456789"].join("-");

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = withDerived.safeParse(source);
  if (!r.success) {
    throw new Error(
      `Invalid environment variables for @collabcode/collaboration: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  if (r.data.NODE_ENV === "production") {
    const token = r.data.COLLAB_INTERNAL_TOKEN;
    if (token === DEV_COLLAB_INTERNAL_TOKEN || token.length < 16) {
      throw new Error(
        "The internal-endpoint shared secret must be a real secret of at least 16 characters in production (the built-in dev default is rejected).",
      );
    }
    // Phase 7: the JWT verification secret gets the same production bar as
    // the API's own guard — at least 32 chars and never the known dev
    // default (previously this service only required 16 via the schema).
    const secret = r.data.COLLAB_JWT_SECRET ?? r.data.JWT_SECRET;
    if (secret !== undefined && (secret.length < 32 || secret === KNOWN_DEV_JWT_SECRET)) {
      throw new Error(
        "COLLAB_JWT_SECRET/JWT_SECRET must be a real secret of at least 32 characters in production (weak or built-in dev secrets are rejected).",
      );
    }
  }
  const singlePortMode =
    r.data.SINGLE_PORT !== undefined
      ? r.data.SINGLE_PORT === "true"
      : r.data.NODE_ENV === "production" && source.PORT !== undefined;
  return { ...r.data, SINGLE_PORT_MODE: singlePortMode };
}

/** The secret used to verify collab tokens: COLLAB_JWT_SECRET wins, JWT_SECRET is the fallback. */
export function collabSecret(env: Env): string {
  const secret = env.COLLAB_JWT_SECRET ?? env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "COLLAB_JWT_SECRET (or JWT_SECRET) must be set — the collaboration server cannot verify tokens without it.",
    );
  }
  return secret;
}

/** The shared secret guarding the internal HTTP endpoints (restore). */
export function collabInternalToken(env: Env): string {
  return env.COLLAB_INTERNAL_TOKEN;
}

export const env: Env = loadEnv();
