import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, api } from "../src/lib/api/client";

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; credentials?: string };
type Call = { url: string; init: FetchInit };

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function env<T>(data: T) {
  return { success: true, data, error: null, requestId: "req-1" };
}

describe("API client (mocked fetch)", () => {
  let calls: Call[];
  let handler: (url: string, init: FetchInit) => Promise<Response>;

  beforeEach(() => {
    calls = [];
    handler = async () => res(200, env(null));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: FetchInit = {}) => {
        calls.push({ url, init });
        return handler(url, init);
      }),
    );
    document.cookie = "cc_csrf=; max-age=0";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "cc_csrf=; max-age=0";
  });

  it("unwraps the success envelope and sends credentials", async () => {
    handler = async () => res(200, env({ id: "u1" }));
    const data = await api.get<{ id: string }>("/api/auth/me");
    expect(data).toEqual({ id: "u1" });
    expect(calls[0]!.url).toBe("/api/auth/me");
    expect(calls[0]!.init.credentials).toBe("include");
  });

  it("sends the CSRF token from the cookie on mutating requests", async () => {
    document.cookie = "cc_csrf=tok-123";
    handler = async () => res(201, env({ id: "p1" }));
    await api.post("/api/projects", { name: "X" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.headers?.["x-csrf-token"]).toBe("tok-123");
  });

  it("bootstraps the CSRF cookie via GET /api/auth/csrf when it is missing", async () => {
    handler = async (url) => {
      if (url === "/api/auth/csrf") {
        document.cookie = "cc_csrf=fresh-tok";
        return res(200, env({ csrfToken: "fresh-tok" }));
      }
      return res(200, env({ ok: true }));
    };
    await api.post("/api/projects", { name: "X" });
    expect(calls.map((c) => c.url)).toEqual(["/api/auth/csrf", "/api/projects"]);
    expect(calls[1]!.init.headers?.["x-csrf-token"]).toBe("fresh-tok");
  });

  it("refreshes once on a 401 and retries the original request", async () => {
    document.cookie = "cc_csrf=tok";
    let meCalls = 0;
    handler = async (url) => {
      if (url === "/api/auth/refresh") return res(200, env({ user: { id: "u1" } }));
      meCalls += 1;
      if (meCalls === 1) return res(401, { success: false, data: null, error: { code: "UNAUTHORIZED", message: "nope" }, requestId: "r" });
      return res(200, env({ id: "u1" }));
    };
    const data = await api.get<{ id: string }>("/api/auth/me");
    expect(data).toEqual({ id: "u1" });
    expect(calls.map((c) => c.url)).toEqual(["/api/auth/me", "/api/auth/refresh", "/api/auth/me"]);
  });

  it("throws ApiClientError with the server code on error envelopes", async () => {
    handler = async () =>
      res(409, { success: false, data: null, error: { code: "CONFLICT", message: "Email already registered" }, requestId: "r2" });
    const err = await api.get("/api/projects").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const apiErr = err as ApiClientError;
    expect(apiErr.name).toBe("ApiClientError");
    expect(apiErr.status).toBe(409);
    expect(apiErr.code).toBe("CONFLICT");
    expect(apiErr.message).toBe("Email already registered");
  });
});
