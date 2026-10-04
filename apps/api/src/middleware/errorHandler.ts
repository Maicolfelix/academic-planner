import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@planner/core';
import { ZodError } from 'zod';
import { AppError, notFound } from '../errors/AppError.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`Route not found: ${req.method} ${req.path}`));
};

export function createErrorHandler(
  opts: { log?: (err: unknown) => void } = {},
): ErrorRequestHandler {
  const log = opts.log ?? ((err) => console.error(err));
  return (err, _req, res, _next) => {
    let status = 500;
    let body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, details: err.details } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues },
      };
    } else if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      status = 400;
      body = { error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } };
    } else {
      log(err); // never leak internals to the client
    }
    res.status(status).json(body);
  };
}
