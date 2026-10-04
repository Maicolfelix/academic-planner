import type { Express } from 'express';
import request from 'supertest';
import { createApp, type AppDeps } from '../src/app.js';
import { createPrisma, pingDatabase } from '../src/db/prisma.js';
import { truncateAll } from './testDb.js';

// vitest.config.ts points DATABASE_URL at TEST_DATABASE_URL for every test worker.
export const prisma = createPrisma(process.env.DATABASE_URL!);

export const ORIGIN = 'http://localhost:5173';

export const resetDb = () => truncateAll(prisma);

export function buildApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    prisma,
    checkDatabase: () => pingDatabase(prisma),
    corsOrigins: [ORIGIN],
    secureCookies: false,
    // High limits so unrelated tests are never throttled; rate-limit tests pass their own.
    rateLimits: { loginMax: 1000, registerMax: 1000 },
    ...overrides,
  });
}

/** Registers a user and returns a supertest agent that carries that user's session cookie. */
export async function signUp(app: Express, email: string, name = 'Test User') {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({ name, email, password: 'correct horse battery' })
    .expect(201);
  return { agent, user: res.body.user as { id: string; email: string } };
}

export const periodInput = {
  name: 'Segundo semestre 2026',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
};

export const credentials = {
  name: 'Ana Pérez',
  email: 'ana@example.com',
  password: 'correct horse battery',
};

/** First `academic_planner_session` Set-Cookie header of a response, if any. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  return raw?.find((c) => c.startsWith('academic_planner_session='));
}

export const tokenFrom = (setCookie: string): string => setCookie.split(';')[0]!.split('=')[1]!;
