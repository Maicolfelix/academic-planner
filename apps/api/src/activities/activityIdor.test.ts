import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, postActivity, prisma, resetDb, setupUser } from '../../test/helpers.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function twoUsers() {
  const a = await setupUser(app, 'a@example.com', 'Materia A');
  const b = await setupUser(app, 'b@example.com', 'Materia B');
  const activityA = (await postActivity(a.agent, a.subject.id, { title: 'Actividad A' })).body
    .activity;
  const activityB = (
    await postActivity(b.agent, b.subject.id, {
      title: 'Actividad B',
      priority: 'HIGH',
      description: 'privada',
    })
  ).body.activity;
  return { a, b, activityA, activityB };
}

const snapshot = async () => ({
  activities: await prisma.activity.findMany({ orderBy: { title: 'asc' } }),
  subjects: await prisma.subject.findMany({ orderBy: { name: 'asc' } }),
});

describe('IDOR: user A can never reach user B’s activities', () => {
  it('GET / PATCH / DELETE activity B and POST into subject B all fail, leaving the database intact', async () => {
    const { a, b, activityB } = await twoUsers();
    const before = await snapshot();
    const rowB = await prisma.activity.findUniqueOrThrow({ where: { id: activityB.id } });

    const attempts = {
      'GET activity B': await a.agent.get(`/api/activities/${activityB.id}`),
      'PATCH activity B': await a.agent
        .patch(`/api/activities/${activityB.id}`)
        .send({ title: 'HACKED', status: 'COMPLETED', priority: 'LOW' }),
      'DELETE activity B': await a.agent.delete(`/api/activities/${activityB.id}`),
      'POST activity using subject B': await postActivity(a.agent, b.subject.id, {
        title: 'Intruso',
      }),
    };

    for (const [label, res] of Object.entries(attempts)) {
      expect(res.status, label).toBe(404);
      expect(res.body.error.code, label).toBe('NOT_FOUND');
    }

    // Verified directly in the database, not through the API.
    expect(await snapshot()).toEqual(before);
    const rowBAfter = await prisma.activity.findUniqueOrThrow({ where: { id: activityB.id } });
    expect(rowBAfter).toEqual(rowB); // not even updatedAt moved
    expect(rowBAfter).toMatchObject({
      title: 'Actividad B',
      priority: 'HIGH',
      status: 'PENDING',
      completedAt: null,
    });
    expect(await prisma.activity.count({ where: { title: 'Intruso' } })).toBe(0);
  });

  it('answers a foreign activity exactly like a non-existent one (no existence oracle)', async () => {
    const { a, b, activityB } = await twoUsers();
    const ghost = randomUUID();
    const pair = async (foreign: request.Test, missing: request.Test) => {
      const [f, m] = await Promise.all([foreign, missing]);
      expect(f.status).toBe(m.status);
      expect(f.body).toEqual(m.body);
    };

    await pair(
      a.agent.get(`/api/activities/${activityB.id}`),
      a.agent.get(`/api/activities/${ghost}`),
    );
    await pair(
      a.agent.patch(`/api/activities/${activityB.id}`).send({ title: 'x' }),
      a.agent.patch(`/api/activities/${ghost}`).send({ title: 'x' }),
    );
    await pair(
      a.agent.delete(`/api/activities/${activityB.id}`),
      a.agent.delete(`/api/activities/${ghost}`),
    );
    await pair(postActivity(a.agent, b.subject.id), postActivity(a.agent, ghost));
  });

  it('A cannot move its own activity into B’s subject', async () => {
    const { a, b, activityA } = await twoUsers();
    const before = await snapshot();
    const res = await a.agent
      .patch(`/api/activities/${activityA.id}`)
      .send({ subjectId: b.subject.id });
    expect(res.status).toBe(404);
    expect(await snapshot()).toEqual(before);
    expect(
      (await prisma.activity.findUniqueOrThrow({ where: { id: activityA.id } })).subjectId,
    ).toBe(a.subject.id);
  });

  it('lists never include B’s activities and filtering by B’s subject leaks nothing', async () => {
    const { a, b } = await twoUsers();
    const list = await a.agent.get('/api/activities');
    expect(list.body.activities.map((x: { title: string }) => x.title)).toEqual(['Actividad A']);

    const filtered = await a.agent.get(`/api/activities?subjectId=${b.subject.id}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.activities).toEqual([]);
    const byPeriod = await a.agent.get(`/api/activities?periodId=${b.period.id}`);
    expect(byPeriod.body.activities).toEqual([]);
  });

  it('a brand new user sees zero activities', async () => {
    await twoUsers();
    const c = await setupUser(app, 'c@example.com');
    expect((await c.agent.get('/api/activities')).body.activities).toEqual([]);
  });

  it('a client-supplied userId can neither create data for B nor reassign A’s data', async () => {
    const { a, b, activityA } = await twoUsers();
    const before = await snapshot();
    const forB = await postActivity(a.agent, a.subject.id, { title: 'Para B', userId: b.user.id });
    const steal = await a.agent
      .patch(`/api/activities/${activityA.id}`)
      .send({ userId: b.user.id });

    expect(forB.status).toBe(400);
    expect(steal.status).toBe(400);
    expect(await snapshot()).toEqual(before);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: activityA.id } })).userId).toBe(
      a.user.id,
    );
  });

  it('works symmetrically: B cannot touch A either', async () => {
    const { b, a, activityA } = await twoUsers();
    const before = await snapshot();
    expect((await b.agent.get(`/api/activities/${activityA.id}`)).status).toBe(404);
    expect(
      (await b.agent.patch(`/api/activities/${activityA.id}`).send({ title: 'x' })).status,
    ).toBe(404);
    expect((await b.agent.delete(`/api/activities/${activityA.id}`)).status).toBe(404);
    expect((await postActivity(b.agent, a.subject.id)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('B cannot delete A’s subject through the new rule either (still 404, nothing changes)', async () => {
    const { a, b } = await twoUsers();
    const before = await snapshot();
    const res = await b.agent.delete(`/api/subjects/${a.subject.id}`);
    expect(res.status).toBe(404); // not 409: the subject’s activities are not revealed
    expect(await snapshot()).toEqual(before);
  });
});
