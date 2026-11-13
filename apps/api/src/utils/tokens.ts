import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/** Short-lived access token (JWT, HS256) carried in the httpOnly `cc_access` cookie. */
export function signAccessToken(userId: string, ttlSeconds?: number): string {
  const ttl = ttlSeconds ?? env.ACCESS_TOKEN_TTL_MIN * 60;
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: ttl });
}

export function verifyAccessToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "object" && typeof payload.sub === "string") return { userId: payload.sub };
    return null;
  } catch {
    return null;
  }
}

/**
 * Collaboration token (Phase 3): short-lived JWT (HS256, audience "collab")
 * presented to the Hocuspocus collaboration server over WebSocket. It carries
 * the project + role claim, but the collaboration server NEVER trusts the
 * claim alone — it re-validates membership and file/project consistency
 * against the database on every connection.
 */
export const COLLAB_TOKEN_TTL_SECONDS = 10 * 60;

export interface CollabTokenClaims {
  userId: string;
  projectId: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  name: string;
}

export function signCollabToken(claims: CollabTokenClaims, ttlSeconds: number = COLLAB_TOKEN_TTL_SECONDS): string {
  return jwt.sign(
    { projectId: claims.projectId, role: claims.role, name: claims.name },
    env.JWT_SECRET,
    { algorithm: "HS256", subject: claims.userId, audience: "collab", expiresIn: ttlSeconds },
  );
}

export function verifyCollabToken(token: string): CollabTokenClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"], audience: "collab" });
    if (typeof payload !== "object" || typeof payload.sub !== "string") return null;
    const p = payload as { projectId?: unknown; role?: unknown; name?: unknown };
    if (typeof p.projectId !== "string" || typeof p.name !== "string") return null;
    if (p.role !== "OWNER" && p.role !== "EDITOR" && p.role !== "VIEWER") return null;
    return { userId: payload.sub, projectId: p.projectId, role: p.role, name: p.name };
  } catch {
    return null;
  }
}

/** Opaque refresh token: only its SHA-256 hash is ever stored (RefreshToken.tokenHash). */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Opaque invitation token (Phase 4): only its SHA-256 hash is ever stored (Invitation.tokenHash). */
export function generateInvitationToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

/** CSRF double-submit token (non-cryptographic use beyond unguessability is not required). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
