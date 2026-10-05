import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@planner/core';
import { z, ZodError } from 'zod';
import { AppError, notFound } from '../errors/AppError.js';

// The same answer for every unknown address: no route list, no echo of what was asked.
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('Recurso no encontrado.'));
};

const isClientHttpError = (err: unknown): err is { status: number; type?: string } =>
  typeof err === 'object' &&
  err !== null &&
  typeof (err as { status?: unknown }).status === 'number' &&
  (err as { status: number }).status >= 400 &&
  (err as { status: number }).status < 500;

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
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Datos inválidos. Revisa los campos marcados.',
          // { fieldName: [messages] } — never echoes the submitted values (e.g. passwords).
          details: { fields: z.flattenError(err).fieldErrors },
        },
      };
    } else if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      status = 400;
      body = {
        error: { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud no es JSON válido.' },
      };
    } else if (isClientHttpError(err)) {
      // A request the HTTP layer itself refused (body too large, bad charset…): its status, our wording.
      status = err.status;
      body =
        err.type === 'entity.too.large'
          ? { error: { code: 'PAYLOAD_TOO_LARGE', message: 'La solicitud es demasiado grande.' } }
          : { error: { code: 'BAD_REQUEST', message: 'Solicitud inválida.' } };
    } else {
      log(err); // never leak internals to the client
    }
    res.status(status).json(body);
  };
}
