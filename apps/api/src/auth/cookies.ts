import type { CookieOptions, Response } from 'express';
import { SESSION_TTL_MS } from './sessions.js';

export const SESSION_COOKIE = 'academic_planner_session';

const baseOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure,
  path: '/',
});

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(secure), maxAge: SESSION_TTL_MS });
}

/** Attributes must match those used when setting, or browsers keep the cookie. */
export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, baseOptions(secure));
}
