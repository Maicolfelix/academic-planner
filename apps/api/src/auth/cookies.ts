import type { CookieOptions, Request, Response } from 'express';
import { SESSION_TTL_MS } from './sessions.js';

/** Development name (plain HTTP). Kept as the reference name for tests and docs. */
export const SESSION_COOKIE = 'academic_planner_session';

/**
 * Over HTTPS the cookie uses the `__Host-` prefix: the browser then refuses it unless it is Secure, has Path=/ and
 * carries no Domain, so a sibling subdomain can never plant or overwrite the session cookie. Browsers reject that
 * prefix without Secure, so plain-HTTP development keeps the plain name.
 */
export const sessionCookieName = (secure: boolean): string =>
  secure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;

const baseOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure,
  path: '/',
});

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(sessionCookieName(secure), token, { ...baseOptions(secure), maxAge: SESSION_TTL_MS });
}

/** Attributes must match those used when setting, or browsers keep the cookie. */
export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(sessionCookieName(secure), baseOptions(secure));
}

/** The session token the browser sent, if it looks like one (real tokens are 43 chars: junk is never looked up). */
export function sessionTokenOf(req: Request, secure: boolean): string | undefined {
  const token: unknown = req.cookies?.[sessionCookieName(secure)];
  return typeof token === 'string' && token.length > 0 && token.length <= 128 ? token : undefined;
}
