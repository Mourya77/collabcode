import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("api health", () => {
  it("GET /health returns ok shape", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
    expect(r.body.service).toBe("api");
    expect(r.headers["x-request-id"]).toBeTruthy();
  });
  it("GET /api/v1/health returns ok shape", async () => {
    const r = await request(app).get("/api/v1/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
  });
  it("unknown route returns 404 ApiError shape", async () => {
    const r = await request(app).get("/no-such-route");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });
  it("loadEnv rejects invalid PORT", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    expect(() => loadEnv({ PORT: "abc" })).toThrow(/Invalid environment/);
  });
});
