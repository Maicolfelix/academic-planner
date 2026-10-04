import { apiErrorSchema, healthResponseSchema } from '@planner/core';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPrisma, pingDatabase } from './db/prisma.js';

const corsOrigins = ['http://localhost:5173'];

describe('error handling', () => {
  const app = createApp({ checkDatabase: async () => true, corsOrigins });

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
    const app = createApp({ checkDatabase: async () => false, corsOrigins });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });

  it('does not leak internals when the check throws', async () => {
    const app = createApp({
      checkDatabase: async () => {
        throw new Error('secret connection string');
      },
      corsOrigins,
    });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('GET /api/health (real PostgreSQL)', () => {
  const prisma = createPrisma(loadEnv().DATABASE_URL);
  afterAll(() => prisma.$disconnect());

  it('reports the database as up', async () => {
    const app = createApp({ checkDatabase: () => pingDatabase(prisma), corsOrigins });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('can read the migrated foundation table', async () => {
    expect(await prisma.appMetadata.count()).toBeGreaterThanOrEqual(0);
  });
});
