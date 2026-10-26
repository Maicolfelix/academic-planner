import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { buildApp, credentials, prisma, resetDb } from '../../test/helpers.js';

/**
 * The production topology is ONE origin: the page and the API share it, and `CORS_ORIGIN` is both the CORS list and the
 * list `originCheck` (CSRF) compares the browser's `Origin` with. These tests wire the app the way `server.ts` does from a
 * production environment and check the three outcomes that matter for a deployment.
 */
const PUBLIC_ORIGIN = 'https://planner.example.edu';
const PRODUCTION_ENV = {
  DATABASE_URL: 'postgresql://unused',
  NODE_ENV: 'production',
  CORS_ORIGIN: PUBLIC_ORIGIN,
  WEB_DIST_DIR: '/app/apps/web/dist',
  TRUST_PROXY: '1',
};

const env = loadEnv(PRODUCTION_ENV);
const app = buildApp({
  corsOrigins: env.CORS_ORIGIN,
  secureCookies: env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
});

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const register = (headers: Record<string, string>) =>
  request(app).post('/api/auth/register').set(headers).send(credentials);

describe('production origin configuration', () => {
  it('the exact public origin is accepted for writes', async () => {
    const res = await register({ Origin: PUBLIC_ORIGIN });
    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe(PUBLIC_ORIGIN);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^__Host-academic_planner_session=/);
  });

  it('any other Origin is refused with 403 INVALID_ORIGIN, and nothing is created', async () => {
    for (const origin of [
      'https://evil.example',
      'https://planner.example.edu.evil.example',
      'http://planner.example.edu', // same host, wrong scheme
      'https://planner.example.edu:8443', // same host, wrong port
      'http://localhost:5173', // the development default is not a production origin
    ]) {
      const res = await register({ Origin: origin });
      expect(res.status, origin).toBe(403);
      expect(res.body.error.code, origin).toBe('INVALID_ORIGIN');
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it('a cross-site browser that omits Origin is refused too (Sec-Fetch-Site)', async () => {
    const res = await register({ 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_ORIGIN');
  });

  it('a configuration without the public origin does not start (nothing silently falls back to localhost)', () => {
    const { CORS_ORIGIN: _omit, ...withoutOrigin } = PRODUCTION_ENV;
    void _omit;
    expect(() => loadEnv(withoutOrigin)).toThrow(/CORS_ORIGIN: required in production/);
    expect(() => loadEnv({ ...PRODUCTION_ENV, CORS_ORIGIN: '*' })).toThrow(/never \*/);
  });
});
