import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A request that carries a body must say what it is: JSON everywhere, multipart only where a file is expected.
 * Anything else is refused BEFORE a parser looks at it (415), instead of being silently ignored.
 */
export function requireKnownBodyType(opts: { multipartPaths: string[] }): RequestHandler {
  return (req, _res, next) => {
    if (!METHODS_WITH_BODY.has(req.method)) return next();
    const hasBody =
      Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding') !== undefined;
    if (!hasBody) return next();
    const multipartOk = opts.multipartPaths.some(
      (p) => req.path === p || req.path.startsWith(`${p}/`),
    );
    if (req.is('application/json') || (multipartOk && req.is('multipart/form-data'))) return next();
    next(
      new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de contenido no admitido para esta ruta.'),
    );
  };
}
