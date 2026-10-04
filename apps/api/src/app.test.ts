import { apiErrorSchema, healthResponseSchema } from '@planner/core';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, prisma } from '../test/helpers.js';

afterAll(() => prisma.$disconnect());

describe('error handling', () => {
  const app = buildApp();

  it('returns the uniform envelope for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns 400 INVALID_JSON for a malformed body', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('GET /api/health (database down)', () => {
  it('answers 503 degraded instead of crashing', async () => {
    const app = buildApp({ checkDatabase: async () => false });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });

  it('does not leak internals when the check throws', async () => {
    const app = buildApp({
      checkDatabase: async () => {
        throw new Error('secret connection string');
      },
    });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('GET /api/health (real PostgreSQL test database)', () => {
  it('reports the database as up', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('can read the migrated tables', async () => {
    expect(await prisma.user.count()).toBeGreaterThanOrEqual(0);
  });
});
