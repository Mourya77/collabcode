import type { ApiEnvelope } from "@collabcode/shared";

/**
 * Typed API client for @collabcode/api.
 *
 * - Base URL: VITE_API_URL when set, otherwise same-origin (the Vite dev/preview
 *   proxy forwards /api to http://localhost:4000).
 * - Cookies: every request sends credentials so the httpOnly session cookies flow.
 * - CSRF: mutating requests echo the CSRF token in the `x-csrf-token` header
 *   (double-submit against the `cc_csrf` cookie). The token is held in memory:
 *   it is seeded from the readable cookie when the app is served same-origin,
 *   and otherwise fetched from GET /api/auth/csrf, whose JSON body carries the
 *   token — `document.cookie` can never see another origin's cookies, so the
 *   cookie alone is not a viable source when the SPA and API are cross-origin
 *   (the production Vercel + Render topology).
 * - Session recovery: a 401 on a non-auth request triggers exactly one
 *   POST /api/auth/refresh (the server rotates the refresh token) and one retry;
 *   if refresh fails, the error propagates and the app routes to /login.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    Object.setPrototypeOf(this, ApiClientError.prototype);
    this.status = status;
    this.code = code;
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return null;
}

let csrfToken: string | null = null;
let csrfInFlight: Promise<void> | null = null;

async function ensureCsrf(force = false): Promise<void> {
  if (!force && csrfToken) return;
  if (!force) {
    // Same-origin serving exposes the readable cookie directly.
    const fromCookie = readCookie("cc_csrf");
    if (fromCookie) {
      csrfToken = fromCookie;
      return;
    }
  }
  csrfInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/csrf`, { credentials: "include" });
      const envelope = (await res.json()) as ApiEnvelope<{ csrfToken: string }>;
      if (envelope?.success && envelope.data?.csrfToken) csrfToken = envelope.data.csrfToken;
    } catch {
      // Network failure: the real request below will surface the error.
    }
  })().finally(() => {
    csrfInFlight = null;
  });
  await csrfInFlight;
}

/** The session (and with it the CSRF cookie) rotates on auth calls; drop the cached token. */
function invalidateCsrf(): void {
  csrfToken = null;
}

async function refreshSession(): Promise<void> {
  await ensureCsrf();
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
  });
  if (!res.ok) throw new ApiClientError(res.status, "UNAUTHORIZED", "Your session has expired. Please log in again.");
  invalidateCsrf();
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set false to disable the single 401 -> refresh -> retry cycle. */
  retryAuth?: boolean;
  /** Abort signal (e.g. cancelling a long-running execution request). */
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const mutating = method !== "GET";
  if (mutating) await ensureCsrf();

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (mutating && csrfToken) headers["x-csrf-token"] = csrfToken;
    return fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  };

  let res = await send();
  // One refresh-and-retry on an expired access token — but never for the
  // credential endpoints themselves (a failed login must not trigger it).
  const isCredentialCall = path.startsWith("/api/auth/login") || path.startsWith("/api/auth/register") || path.startsWith("/api/auth/refresh");
  if (res.status === 401 && opts.retryAuth !== false && !isCredentialCall) {
    try {
      await refreshSession();
      res = await send();
    } catch {
      // Fall through: the original 401 envelope is reported below.
    }
  }
  // A CSRF rejection means the cached token no longer matches the cookie
  // (e.g. the session rotated). Refetch the token and retry exactly once.
  if (res.status === 403 && mutating) {
    let csrfRejected = false;
    try {
      const peek = (await res.clone().json()) as ApiEnvelope<unknown>;
      csrfRejected = (peek?.error?.message ?? "").includes("CSRF");
    } catch {
      csrfRejected = false;
    }
    if (csrfRejected) {
      invalidateCsrf();
      await ensureCsrf(true);
      res = await send();
    }
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }
  if (!res.ok || !envelope?.success) {
    throw new ApiClientError(
      res.status,
      envelope?.error?.code ?? "INTERNAL",
      envelope?.error?.message ?? `Request failed (${res.status}).`,
    );
  }
  // Login/register rotate the session cookies, including the CSRF cookie —
  // the next mutating call must refetch the matching token.
  if (isCredentialCall) invalidateCsrf();
  return envelope.data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
