import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from './errors.js';
import { healthResponseSchema } from './health.js';

describe('shared schemas', () => {
  it('accepts a valid health payload', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      database: 'up',
      timestamp: new Date().toISOString(),
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects an invalid health payload', () => {
    expect(healthResponseSchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('validates the error envelope', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'X', message: 'y' } }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ message: 'y' }).success).toBe(false);
  });
});
