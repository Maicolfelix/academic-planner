import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiDownload, fetchHealth } from './client';

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

describe('apiDownload', () => {
  it('returns the bytes of a file answer and sends the session cookie', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('BEGIN:VCALENDAR', {
          status: 200,
          headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const blob = await apiDownload('/api/activities/x/calendar.ics');
    expect(await blob.text()).toBe('BEGIN:VCALENDAR');
    expect(fetchMock).toHaveBeenCalledWith('/api/activities/x/calendar.ics', {
      credentials: 'include',
    });
  });

  it('turns the API error envelope into a typed error (a 404 is not a file)', async () => {
    mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Actividad no encontrada.' } });
    await expect(apiDownload('/api/activities/x/calendar.ics')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('reports an unreadable error and a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 502 })),
    );
    await expect(apiDownload('/x')).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await expect(apiDownload('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
