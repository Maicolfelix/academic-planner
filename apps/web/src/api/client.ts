import { apiErrorSchema, healthResponseSchema, type HealthResponse } from '@planner/core';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
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
