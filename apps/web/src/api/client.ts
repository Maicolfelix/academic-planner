import { apiErrorSchema, healthResponseSchema, type HealthResponse } from '@planner/core';
import type { ZodType } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  /** Server-side per-field messages (VALIDATION_ERROR), `{}` otherwise. */
  get fieldErrors(): Record<string, string[]> {
    const fields = (this.details as { fields?: Record<string, string[]> } | undefined)?.fields;
    return fields ?? {};
  }
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON-encoded, except a `FormData` (a file upload), which is sent as it is. */
  body?: unknown;
  /** Lets the caller cancel a long request (e.g. reading a schedule image). */
  signal?: AbortSignal;
  /** Validates the success payload; omit for 204 responses. */
  schema?: ZodType<T>;
}

/** The error of a non-2xx answer: the API's envelope when it sent one, a generic one otherwise. */
function responseError(status: number, payload: unknown): ApiRequestError {
  const parsed = apiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiRequestError(status, code, message, details);
  }
  return new ApiRequestError(status, 'UNEXPECTED_RESPONSE', `Respuesta inesperada (${status}).`);
}

/**
 * Single door to the API. Sends the session cookie (same-origin via the Vite proxy),
 * turns the error envelope into `ApiRequestError`, and validates success payloads.
 */
export async function apiFetch<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers:
        opts.body === undefined || opts.body instanceof FormData
          ? undefined
          : { 'Content-Type': 'application/json' },
      body:
        opts.body === undefined || opts.body instanceof FormData
          ? (opts.body as FormData | undefined)
          : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiRequestError(0, 'ABORTED', 'Se canceló la operación.');
    }
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor.');
  }

  const payload: unknown = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) throw responseError(res.status, payload);

  if (!opts.schema) return undefined as T;
  const parsed = opts.schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRequestError(
      res.status,
      'UNEXPECTED_RESPONSE',
      'La respuesta del servidor no es válida.',
    );
  }
  return parsed.data;
}

/** A GET whose success answer is a file (e.g. the .ics of an activity): the bytes, with the same error handling. */
export async function apiDownload(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'include' });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor.');
  }
  if (!res.ok) throw responseError(res.status, await res.json().catch(() => null));
  return res.blob();
}

/** Fetches /api/health. A 503 (database down) is still a valid, parseable health payload. */
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health', { credentials: 'include' });
  const body: unknown = await res.json().catch(() => null);

  const health = healthResponseSchema.safeParse(body);
  if (health.success) return health.data;

  const apiError = apiErrorSchema.safeParse(body);
  throw new ApiRequestError(
    res.status,
    apiError.success ? apiError.data.error.code : 'UNEXPECTED_RESPONSE',
    apiError.success ? apiError.data.error.message : `Unexpected response (${res.status})`,
  );
}
