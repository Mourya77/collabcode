import type { Response } from "express";
import { env } from "../config/env.js";

export const ACCESS_COOKIE = "cc_access";
export const REFRESH_COOKIE = "cc_refresh";
export const CSRF_COOKIE = "cc_csrf";
export const REFRESH_COOKIE_PATH = "/api/auth";

export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

function base() {
  return { sameSite: "lax" as const, secure: env.COOKIE_SECURE_BOOL };
}

/** Sets the session cookies: httpOnly access + refresh, plus the readable CSRF cookie. */
export function setAuthCookies(res: Response, s: SessionCookies): void {
  res.cookie(ACCESS_COOKIE, s.accessToken, {
    ...base(),
    httpOnly: true,
    path: "/",
    maxAge: env.ACCESS_TOKEN_TTL_MIN * 60_000,
  });
  res.cookie(REFRESH_COOKIE, s.refreshToken, {
    ...base(),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  res.cookie(CSRF_COOKIE, s.csrfToken, {
    ...base(),
    httpOnly: false, // double-submit token: the SPA must be able to read it
    path: "/",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, { ...base(), httpOnly: false, path: "/", maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(), httpOnly: true, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base(), httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base(), httpOnly: false, path: "/" });
}
