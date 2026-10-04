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
  body?: unknown;
  /** Validates the success payload; omit for 204 responses. */
  schema?: ZodType<T>;
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
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor.');
  }

  const payload: unknown = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(res.status, code, message, details);
    }
    throw new ApiRequestError(
      res.status,
      'UNEXPECTED_RESPONSE',
      `Respuesta inesperada (${res.status}).`,
    );
  }

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
