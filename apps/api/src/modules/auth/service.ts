import { env } from "../../config/env.js";
import type { Repos } from "../../repositories/types.js";
import { ApiError, UniqueViolationError, conflict, unauthorized } from "../../utils/errors.js";
import { dummyHash, hashPassword, verifyPassword } from "../../utils/password.js";
import { generateCsrfToken, generateRefreshToken, hashToken, signAccessToken } from "../../utils/tokens.js";
import { toPublicUser } from "../users/service.js";
import type { LoginInput, RegisterInput } from "./schemas.js";
import type { PublicUser, Session } from "./types.js";

export interface AuthResult {
  user: PublicUser;
  session: Session;
}

export class AuthService {
  constructor(private readonly repos: Repos) {}

  /** Issues a fresh session: access JWT + a persisted (hashed) rotating refresh token + CSRF token. */
  private async issueSession(userId: string): Promise<Session> {
    const refresh = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await this.repos.tokens.create({ userId, tokenHash: refresh.hash, expiresAt });
    return { accessToken: signAccessToken(userId), refreshToken: refresh.raw, csrfToken: generateCsrfToken() };
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await this.repos.users.findByEmail(input.email);
    if (existing) throw conflict("An account with this email already exists.");
    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      user = await this.repos.users.create({ name: input.name, email: input.email, passwordHash });
    } catch (e) {
      if (e instanceof UniqueViolationError) throw conflict("An account with this email already exists.");
      throw e;
    }
    const session = await this.issueSession(user.id);
    return { user: toPublicUser(user), session };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.repos.users.findByEmail(input.email);
    // Always run one Argon2 verify (against a dummy hash for unknown emails) so
    // timing does not reveal whether the account exists.
    const hash = user?.passwordHash ?? (await dummyHash());
    const ok = await verifyPassword(hash, input.password);
    if (!user || !ok) throw unauthorized("Invalid email or password.");
    const session = await this.issueSession(user.id);
    return { user: toPublicUser(user), session };
  }

  /**
   * Refresh-token rotation: the presented token is revoked and a new one issued.
   * Presenting an already-revoked token is treated as theft: every refresh token
   * for that user is revoked.
   */
  async refresh(rawToken: string | undefined): Promise<AuthResult> {
    if (!rawToken) throw unauthorized("Missing refresh token.");
    const row = await this.repos.tokens.findByHash(hashToken(rawToken));
    if (!row) throw unauthorized("Invalid refresh token.");
    if (row.revokedAt) {
      await this.repos.tokens.revokeAllForUser(row.userId);
      throw new ApiError(401, "UNAUTHORIZED", "Refresh token reuse detected. Please log in again.");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.repos.tokens.revoke(row.id);
      throw unauthorized("Refresh token expired. Please log in again.");
    }
    const user = await this.repos.users.findById(row.userId);
    if (!user) throw unauthorized("Invalid refresh token.");
    const session = await this.repos.withTransaction(async (r) => {
      await r.tokens.revoke(row.id);
      const refresh = generateRefreshToken();
      const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
      await r.tokens.create({ userId: user.id, tokenHash: refresh.hash, expiresAt });
      return { accessToken: signAccessToken(user.id), refreshToken: refresh.raw, csrfToken: generateCsrfToken() };
    });
    return { user: toPublicUser(user), session };
  }

  /** Revokes the presented refresh token (server-side logout). Unknown tokens are a no-op. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const row = await this.repos.tokens.findByHash(hashToken(rawToken));
    if (row && !row.revokedAt) await this.repos.tokens.revoke(row.id);
  }
}
