import { z } from "zod";

export type UserRole = "USER" | "ADMIN";
export type ProjectRole = "OWNER" | "EDITOR" | "VIEWER";
export const USER_ROLES: readonly UserRole[] = ["USER", "ADMIN"];
export const PROJECT_ROLES: readonly ProjectRole[] = ["OWNER", "EDITOR", "VIEWER"];

export interface ApiErrorBody { code: string; message: string; details?: unknown }
export interface ApiError { error: ApiErrorBody & { requestId?: string } }
export interface ApiEnvelope<T> { success: boolean; data: T | null; error: ApiErrorBody | null; requestId: string }
export function makeApiError(code: string, message: string, details?: unknown, requestId?: string): ApiError {
  return { error: { code, message, ...(details !== undefined ? { details } : {}), ...(requestId ? { requestId } : {}) } };
}
export function okEnvelope<T>(data: T, requestId: string): ApiEnvelope<T> {
  return { success: true, data, error: null, requestId };
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  timestamp: string;
  uptime?: number;
}
export function makeHealth(service: string, version = "0.1.0", status: HealthStatus["status"] = "ok"): HealthStatus {
  const uptime = typeof process !== "undefined" && typeof process.uptime === "function" ? process.uptime() : 0;
  return { status, service, version, timestamp: new Date().toISOString(), uptime };
}
export const healthStatusSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.string().datetime(),
});

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
});
export type BaseEnv = z.infer<typeof baseEnvSchema>;
export function parseEnv<T extends z.ZodRawShape>(shape: T, source: Record<string, string | undefined> = process.env) {
  const schema = baseEnvSchema.extend(shape);
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return result.data;
}
