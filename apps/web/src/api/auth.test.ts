import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMe, loginRequest } from './auth';
import { ApiRequestError } from './client';

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );

const user = {
  id: '0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11',
  name: 'Ana',
  email: 'ana@example.com',
  timezone: 'America/Bogota',
  createdAt: new Date().toISOString(),
};

afterEach(() => vi.unstubAllGlobals());

describe('fetchMe', () => {
  it('returns the user when signed in', async () => {
    respond(200, { user });
    expect(await fetchMe()).toEqual(user);
  });

  it('returns null (not an error) on 401', async () => {
    respond(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    expect(await fetchMe()).toBeNull();
  });

  it('propagates server failures so the UI does not pretend the user is signed out', async () => {
    respond(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    await expect(fetchMe()).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('maps a network failure to NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(fetchMe()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('rejects a payload that does not match the schema', async () => {
    respond(200, { user: { id: 'not-a-uuid' } });
    await expect(fetchMe()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });
});

describe('loginRequest', () => {
  it('exposes the generic credentials message from the API', async () => {
    respond(401, {
      error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos.' },
    });
    await expect(loginRequest({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Correo o contraseña incorrectos.',
    });
  });

  it('exposes per-field validation errors', async () => {
    respond(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'x',
        details: { fields: { email: ['Ingresa un correo válido.'] } },
      },
    });
    const err = await loginRequest({ email: 'a@b.co', password: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.fieldErrors.email).toEqual(['Ingresa un correo válido.']);
  });
});
