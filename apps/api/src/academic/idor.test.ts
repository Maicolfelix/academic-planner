import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

/** User A and user B, each with a period and a subject. */
async function twoUsers() {
  const a = await signUp(app, 'a@example.com', 'Alice');
  const b = await signUp(app, 'b@example.com', 'Bob');
  const periodA = (await a.agent.post('/api/periods').send({ ...periodInput, name: 'Periodo A' }))
    .body.period;
  const periodB = (await b.agent.post('/api/periods').send({ ...periodInput, name: 'Periodo B' }))
    .body.period;
  const subjectA = (
    await a.agent.post('/api/subjects').send({ periodId: periodA.id, name: 'Materia A' })
  ).body.subject;
  const subjectB = (
    await b.agent
      .post('/api/subjects')
      .send({ periodId: periodB.id, name: 'Materia B', professor: 'Prof B' })
  ).body.subject;
  return { a, b, periodA, periodB, subjectA, subjectB };
}

const snapshot = async () => ({
  periods: await prisma.academicPeriod.findMany({ orderBy: { name: 'asc' } }),
  subjects: await prisma.subject.findMany({ orderBy: { name: 'asc' } }),
});

describe('IDOR: user A can never reach user B’s academic data', () => {
  it('GET / PATCH / DELETE subject B and POST a subject into period B all fail, leaving data intact', async () => {
    const { a, periodB, subjectB } = await twoUsers();
    const before = await snapshot();
    const rowB = await prisma.subject.findUniqueOrThrow({ where: { id: subjectB.id } });

    const attempts = {
      'GET subject B': await a.agent.get(`/api/subjects/${subjectB.id}`),
      'PATCH subject B': await a.agent
        .patch(`/api/subjects/${subjectB.id}`)
        .send({ name: 'HACKED', color: '#EF4444' }),
      'DELETE subject B': await a.agent.delete(`/api/subjects/${subjectB.id}`),
      'POST subject using period B': await a.agent
        .post('/api/subjects')
        .send({ periodId: periodB.id, name: 'Intruso' }),
    };

    for (const [label, res] of Object.entries(attempts)) {
      expect(res.status, label).toBe(404);
      expect(res.body.error.code, label).toBe('NOT_FOUND');
    }

    // Verified directly in the database, not through the API.
    const after = await snapshot();
    expect(after).toEqual(before);
    const rowBAfter = await prisma.subject.findUniqueOrThrow({ where: { id: subjectB.id } });
    expect(rowBAfter).toEqual(rowB); // including updatedAt: not even touched
    expect(rowBAfter).toMatchObject({ name: 'Materia B', professor: 'Prof B', color: '#3B82F6' });
    expect(await prisma.subject.count({ where: { name: 'Intruso' } })).toBe(0);
  });

  it('GET / PATCH / DELETE period B fail, leaving data intact', async () => {
    const { a, periodB } = await twoUsers();
    const before = await snapshot();

    const attempts = [
      await a.agent.get(`/api/periods/${periodB.id}`),
      await a.agent.patch(`/api/periods/${periodB.id}`).send({ name: 'HACKED', isCurrent: true }),
      await a.agent.delete(`/api/periods/${periodB.id}`),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('answers a foreign resource exactly like a non-existent one (no existence oracle)', async () => {
    const { a, periodB, subjectB } = await twoUsers();
    const ghost = randomUUID();
    const pair = async (foreign: request.Test, missing: request.Test) => {
      const [f, m] = await Promise.all([foreign, missing]);
      expect(f.status).toBe(m.status);
      expect(f.body).toEqual(m.body);
    };

    await pair(a.agent.get(`/api/subjects/${subjectB.id}`), a.agent.get(`/api/subjects/${ghost}`));
    await pair(
      a.agent.patch(`/api/subjects/${subjectB.id}`).send({ name: 'x' }),
      a.agent.patch(`/api/subjects/${ghost}`).send({ name: 'x' }),
    );
    await pair(
      a.agent.delete(`/api/subjects/${subjectB.id}`),
      a.agent.delete(`/api/subjects/${ghost}`),
    );
    await pair(a.agent.get(`/api/periods/${periodB.id}`), a.agent.get(`/api/periods/${ghost}`));
    await pair(
      a.agent.post('/api/subjects').send({ periodId: periodB.id, name: 'x' }),
      a.agent.post('/api/subjects').send({ periodId: ghost, name: 'x' }),
    );
  });

  it('lists never include B’s data, and filtering by B’s period leaks nothing', async () => {
    const { a, periodB } = await twoUsers();

    const subjects = await a.agent.get('/api/subjects');
    expect(subjects.body.subjects.map((s: { name: string }) => s.name)).toEqual(['Materia A']);
    const periods = await a.agent.get('/api/periods');
    expect(periods.body.periods.map((p: { name: string }) => p.name)).toEqual(['Periodo A']);

    const filtered = await a.agent.get(`/api/subjects?periodId=${periodB.id}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.subjects).toEqual([]);
  });

  it('a client-supplied userId can neither create data for B nor reassign A’s data', async () => {
    const { a, b, periodA, subjectA } = await twoUsers();
    const before = await snapshot();

    const forPeriod = await a.agent
      .post('/api/periods')
      .send({ ...periodInput, name: 'Para B', userId: b.user.id });
    const forSubject = await a.agent
      .post('/api/subjects')
      .send({ periodId: periodA.id, name: 'Para B', userId: b.user.id });
    const steal = await a.agent.patch(`/api/subjects/${subjectA.id}`).send({ userId: b.user.id });

    for (const res of [forPeriod, forSubject, steal]) expect(res.status).toBe(400);
    expect(await snapshot()).toEqual(before);
    expect((await prisma.subject.findUniqueOrThrow({ where: { id: subjectA.id } })).userId).toBe(
      a.user.id,
    );
  });

  it('works symmetrically: B cannot touch A either', async () => {
    const { b, periodA, subjectA } = await twoUsers();
    const before = await snapshot();

    expect((await b.agent.get(`/api/subjects/${subjectA.id}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/subjects/${subjectA.id}`).send({ name: 'x' })).status).toBe(
      404,
    );
    expect((await b.agent.delete(`/api/subjects/${subjectA.id}`)).status).toBe(404);
    expect(
      (await b.agent.post('/api/subjects').send({ periodId: periodA.id, name: 'x' })).status,
    ).toBe(404);
    expect((await b.agent.delete(`/api/periods/${periodA.id}`)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('marking B’s period current from A does not alter B’s current period', async () => {
    const { a, periodA, periodB } = await twoUsers();
    await a.agent.patch(`/api/periods/${periodB.id}`).send({ isCurrent: true }).expect(404);
    const rowB = await prisma.academicPeriod.findUniqueOrThrow({ where: { id: periodB.id } });
    const rowA = await prisma.academicPeriod.findUniqueOrThrow({ where: { id: periodA.id } });
    expect(rowB.isCurrent).toBe(true);
    expect(rowA.isCurrent).toBe(true);
  });
});
