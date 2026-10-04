import type { Request, RequestHandler } from 'express';
import { clearSessionCookie, SESSION_COOKIE } from '../auth/cookies.js';
import type { AuthContext, SessionService } from '../auth/sessions.js';
import { AppError } from '../errors/AppError.js';

declare global {
  // Express's own extension point for Request augmentation is a namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Read it through `authOf(req)` to get a non-optional type. */
      auth?: AuthContext;
    }
  }
}

export const unauthenticated = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión para continuar.');

/** Typed accessor for handlers mounted behind `requireAuth`: no casts, no `undefined`. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated(); // programming error if reached: route lacks requireAuth
  return req.auth;
}

export function createRequireAuth(
  sessions: SessionService,
  secureCookies: boolean,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const token: unknown = req.cookies?.[SESSION_COOKIE];
      // Real tokens are 43 chars (32 bytes, base64url); reject junk before touching the DB.
      const auth =
        typeof token === 'string' && token.length > 0 && token.length <= 128
          ? await sessions.resolve(token)
          : null;
      if (!auth) {
        if (token !== undefined) clearSessionCookie(res, secureCookies);
        throw unauthenticated();
      }
      req.auth = auth;
      next();
    } catch (err) {
      next(err);
    }
  };
}
