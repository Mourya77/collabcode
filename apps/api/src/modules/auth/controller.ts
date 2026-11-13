import type { Request, Response } from "express";
import { okEnvelope } from "@collabcode/shared";
import { clearAuthCookies, setAuthCookies, setCsrfCookie, REFRESH_COOKIE, CSRF_COOKIE } from "../../utils/cookies.js";
import { generateCsrfToken } from "../../utils/tokens.js";
import { validatedBody } from "../../middleware/validate.js";
import { UsersService } from "../users/service.js";
import type { AuthService } from "./service.js";
import type { LoginInput, RegisterInput } from "./schemas.js";

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  /** Returns the current CSRF token, issuing (and setting) one if the cookie is absent. */
  csrf = (req: Request, res: Response): void => {
    const existing = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const token = existing ?? generateCsrfToken();
    if (!existing) setCsrfCookie(res, token);
    res.json(okEnvelope({ csrfToken: token }, req.requestId ?? ""));
  };

  register = async (req: Request, res: Response): Promise<void> => {
    const result = await this.auth.register(validatedBody<RegisterInput>(req));
    setAuthCookies(res, result.session);
    res.status(201).json(okEnvelope(result.user, req.requestId ?? ""));
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const result = await this.auth.login(validatedBody<LoginInput>(req));
    setAuthCookies(res, result.session);
    res.json(okEnvelope(result.user, req.requestId ?? ""));
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(raw);
    setAuthCookies(res, result.session);
    res.json(okEnvelope(result.user, req.requestId ?? ""));
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(raw);
    clearAuthCookies(res);
    res.json(okEnvelope({ loggedOut: true }, req.requestId ?? ""));
  };

  me = async (req: Request, res: Response): Promise<void> => {
    const user = await this.users.getById(req.userId as string);
    res.json(okEnvelope(user, req.requestId ?? ""));
  };
}
