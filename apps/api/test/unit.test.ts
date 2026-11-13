import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword } from "../src/utils/password.js";
import { generateInvitationToken, generateRefreshToken, hashToken, signAccessToken, verifyAccessToken } from "../src/utils/tokens.js";
import { joinPath, validateFileName } from "../src/utils/paths.js";
import { paginate, parsePagination } from "../src/utils/pagination.js";
import { roleSatisfies } from "../src/utils/roles.js";
import { makeRateLimiter } from "../src/middleware/rateLimits.js";
import { loadEnv } from "../src/config/env.js";

describe("password hashing (argon2id)", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword(hash, "correct horse battery")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });
});

describe("tokens", () => {
  it("signs and verifies access tokens", () => {
    const token = signAccessToken("user-123");
    expect(verifyAccessToken(token)).toEqual({ userId: "user-123" });
  });
  it("rejects tokens signed with another secret and garbage", () => {
    const foreign = jwt.sign({ sub: "user-123" }, "a-completely-different-secret-that-is-long", { algorithm: "HS256" });
    expect(verifyAccessToken(foreign)).toBeNull();
    expect(verifyAccessToken("not-a-token")).toBeNull();
  });
  it("refresh tokens are opaque; only the sha256 hash is stored", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).toBe(hashToken(a.raw));
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.hash).not.toContain(a.raw);
  });
  it("invitation tokens (Phase 4) are 32 random bytes (hex), unique, hash-only storage", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a.raw).not.toBe(b.raw);
    // 32 bytes hex-encoded → 64 chars (same encoding as refresh/CSRF tokens).
    expect(a.raw).toMatch(/^[a-f0-9]{64}$/);
    expect(a.hash).toBe(hashToken(a.raw));
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.hash).not.toBe(a.raw);
  });
});

describe("file name validation (path traversal defence)", () => {
  it("accepts ordinary names", () => {
    for (const ok of ["main.ts", "welcome.md", "my folder", "a.b.c", "ünïcode.ts"]) {
      expect(validateFileName(ok), ok).toBeNull();
    }
  });
  it("rejects traversal and separators", () => {
    for (const bad of ["../evil.ts", "..", ".", "a/b.ts", "a\\b.ts", "/abs.ts", "", "   ", "x".repeat(256)]) {
      expect(validateFileName(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });
  it("joinPath composes paths", () => {
    expect(joinPath(null, "a.ts")).toBe("a.ts");
    expect(joinPath("src", "a.ts")).toBe("src/a.ts");
  });
});

describe("pagination", () => {
  it("defaults and clamps", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(parsePagination({ page: "2", limit: "500" })).toEqual({ page: 2, limit: 100, offset: 100 });
    expect(parsePagination({ page: "abc", limit: "-3" })).toEqual({ page: 1, limit: 20, offset: 0 });
  });
  it("paginate slices with totals", () => {
    const r = paginate([1, 2, 3, 4, 5], { page: 2, limit: 2, offset: 2 });
    expect(r).toEqual({ items: [3, 4], total: 5, page: 2, limit: 2 });
  });
});

describe("permission hierarchy", () => {
  it("OWNER > EDITOR > VIEWER", () => {
    expect(roleSatisfies("OWNER", "VIEWER")).toBe(true);
    expect(roleSatisfies("OWNER", "OWNER")).toBe(true);
    expect(roleSatisfies("EDITOR", "VIEWER")).toBe(true);
    expect(roleSatisfies("EDITOR", "EDITOR")).toBe(true);
    expect(roleSatisfies("EDITOR", "OWNER")).toBe(false);
    expect(roleSatisfies("VIEWER", "EDITOR")).toBe(false);
    expect(roleSatisfies("VIEWER", "VIEWER")).toBe(true);
  });
});

describe("rate limiter factory", () => {
  it("returns 429 RATE_LIMITED envelope over the max", async () => {
    const app = express();
    app.use((req, _res, next) => { req.requestId = "test-req"; next(); });
    app.use(makeRateLimiter({ windowMs: 60_000, max: 2 }));
    app.get("/x", (_req, res) => res.json({ ok: true }));
    await request(app).get("/x").expect(200);
    await request(app).get("/x").expect(200);
    const r = await request(app).get("/x");
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("env validation", () => {
  it("rejects the dev JWT secret in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
    expect(
      loadEnv({
        NODE_ENV: "production",
        JWT_SECRET: "x".repeat(40),
        EXECUTION_INTERNAL_TOKEN: "y".repeat(24),
        COLLAB_INTERNAL_TOKEN: "z".repeat(24),
      }).NODE_ENV,
    ).toBe("production");
  });
  it("rejects the dev execution token in production (Phase 5)", () => {
    expect(() => loadEnv({ NODE_ENV: "production", JWT_SECRET: "x".repeat(40) })).toThrow(/EXECUTION_INTERNAL_TOKEN/);
  });
  it("rejects the dev collab token in production (Phase 6)", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production", JWT_SECRET: "x".repeat(40), EXECUTION_INTERNAL_TOKEN: "y".repeat(24) }),
    ).toThrow(/COLLAB_INTERNAL_TOKEN/);
  });
  it("exposes auth TTL defaults", () => {
    const e = loadEnv({});
    expect(e.ACCESS_TOKEN_TTL_MIN).toBe(15);
    expect(e.REFRESH_TOKEN_TTL_DAYS).toBe(7);
  });
});
