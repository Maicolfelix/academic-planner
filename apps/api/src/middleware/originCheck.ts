import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth on top of SameSite=Lax: state-changing requests must come from an allowed origin.
 *  - `Origin` present  -> must be in the allow-list.
 *  - no `Origin`, `Sec-Fetch-Site` present -> must be same-origin/none (blocks cross-site browsers that omit Origin).
 *  - neither header -> non-browser client (curl, tests); a browser attacker cannot produce this, so it is allowed.
 */
export function originCheck(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    const ok = origin
      ? allowed.has(origin)
      : fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';

    if (!ok) {
      return next(new AppError(403, 'INVALID_ORIGIN', 'Origen de la solicitud no permitido.'));
    }
    next();
  };
}
