import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults and splits CORS origins', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x', CORS_ORIGIN: 'http://a, http://b' });
    expect(env.API_PORT).toBe(3000);
    expect(env.CORS_ORIGIN).toEqual(['http://a', 'http://b']);
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
