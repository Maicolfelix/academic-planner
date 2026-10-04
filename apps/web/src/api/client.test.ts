import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './client';

const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe('fetchHealth', () => {
  it('returns a valid payload', async () => {
    mockFetch(200, { status: 'ok', database: 'up', timestamp: new Date().toISOString() });
    expect((await fetchHealth()).database).toBe('up');
  });

  it('treats a 503 health payload as data, not an exception', async () => {
    mockFetch(503, { status: 'degraded', database: 'down', timestamp: new Date().toISOString() });
    expect((await fetchHealth()).status).toBe('degraded');
  });

  it('throws a typed error for the API error envelope', async () => {
    mockFetch(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    await expect(fetchHealth()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
  });

  it('throws on a non-JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 502 })),
    );
    await expect(fetchHealth()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });
});
