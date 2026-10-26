import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_TOKEN_TTL_MS } from './session.service';

export const REFRESH_COOKIE = 'lp_refresh';

/**
 * The refresh token's cookie:
 * - httpOnly: page JavaScript (and any injected script) cannot read it.
 * - Secure in production: never sent over plain HTTP.
 * - SameSite=Lax: a cross-site POST from another page does not carry it,
 *   which keeps /auth/refresh safe from CSRF while web and API share a site.
 * - Path=/auth: only the auth routes ever receive it.
 * Cross-site deploys need a different setup; see docs/backlog.md (M6).
 */
function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/auth' };
}

export function setRefreshCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(secure), maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions(secure));
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
