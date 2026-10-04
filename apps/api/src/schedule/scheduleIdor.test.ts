import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, prisma, resetDb, setupUser } from '../../test/helpers.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Body = Record<string, unknown>;
const block = (over: Body = {}): Body => ({
  type: 'STUDY',
  title: 'Bloque',
  date: '2026-10-07',
  startTime: '14:00',
  endTime: '15:00',
  ...over,
});
const post = (agent: request.Agent, body: Body) => agent.post('/api/schedule').send(body);

async function twoUsers() {
  const a = await setupUser(app, 'a@example.com', 'Materia A');
  const b = await setupUser(app, 'b@example.com', 'Materia B');
  const blockA = (await post(a.agent, block({ title: 'Bloque de A' }))).body.block;
  const blockB = (
    await post(
      b.agent,
      block({
        title: 'Bloque de B',
        type: 'CLASS',
        subjectId: b.subject.id,
        startTime: '09:00',
        endTime: '10:00',
      }),
    )
  ).body.block;
  return { a, b, blockA, blockB };
}

const snapshot = async () => ({
  blocks: await prisma.scheduleBlock.findMany({ orderBy: { title: 'asc' } }),
  subjects: await prisma.subject.findMany({ orderBy: { name: 'asc' } }),
  periods: await prisma.academicPeriod.findMany({ orderBy: { name: 'asc' } }),
});

describe('IDOR: user A can never reach user B’s schedule', () => {
  it('GET / PATCH / DELETE block B, and creating with B’s subject or period, all fail leaving the database intact', async () => {
    const { a, b, blockB } = await twoUsers();
    const before = await snapshot();
    const rowB = await prisma.scheduleBlock.findUniqueOrThrow({ where: { id: blockB.id } });

    const attempts = {
      'GET block B': await a.agent.get(`/api/schedule/${blockB.id}`),
      'PATCH block B': await a.agent
        .patch(`/api/schedule/${blockB.id}`)
        .send({ title: 'HACKED', startTime: '01:00', endTime: '02:00' }),
      'DELETE block B': await a.agent.delete(`/api/schedule/${blockB.id}`),
      'POST with subject B': await post(
        a.agent,
        block({ title: 'Intruso', subjectId: b.subject.id }),
      ),
      'POST with period B': await post(
        a.agent,
        block({ title: 'Intruso 2', periodId: b.period.id }),
      ),
    };
    for (const [label, res] of Object.entries(attempts)) {
      expect(res.status, label).toBe(404);
      expect(res.body.error.code, label).toBe('NOT_FOUND');
    }

    // Verified directly in the database, not through the API.
    expect(await snapshot()).toEqual(before);
    const rowBAfter = await prisma.scheduleBlock.findUniqueOrThrow({ where: { id: blockB.id } });
    expect(rowBAfter).toEqual(rowB); // not even updatedAt moved
    expect(await prisma.scheduleBlock.count({ where: { title: { startsWith: 'Intruso' } } })).toBe(
      0,
    );
  });

  it('answers a foreign block exactly like a non-existent one (no existence oracle)', async () => {
    const { a, b, blockB } = await twoUsers();
    const ghost = randomUUID();
    const pair = async (foreign: request.Test, missing: request.Test) => {
      const [f, m] = await Promise.all([foreign, missing]);
      expect(f.status).toBe(m.status);
      expect(f.body).toEqual(m.body);
    };

    await pair(a.agent.get(`/api/schedule/${blockB.id}`), a.agent.get(`/api/schedule/${ghost}`));
    await pair(
      a.agent.patch(`/api/schedule/${blockB.id}`).send({ title: 'x' }),
      a.agent.patch(`/api/schedule/${ghost}`).send({ title: 'x' }),
    );
    await pair(
      a.agent.delete(`/api/schedule/${blockB.id}`),
      a.agent.delete(`/api/schedule/${ghost}`),
    );
    await pair(
      post(a.agent, block({ subjectId: b.subject.id })),
      post(a.agent, block({ subjectId: ghost })),
    );
    await pair(
      post(a.agent, block({ periodId: b.period.id })),
      post(a.agent, block({ periodId: ghost })),
    );
  });

  it('A cannot attach its own block to B’s subject', async () => {
    const { a, b, blockA } = await twoUsers();
    const before = await snapshot();
    const res = await a.agent.patch(`/api/schedule/${blockA.id}`).send({ subjectId: b.subject.id });
    expect(res.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('the weekly query never includes B’s blocks, and a dry run never reveals B’s conflicts', async () => {
    const { a } = await twoUsers();
    const week = await a.agent.get('/api/schedule?from=2026-10-05&to=2026-10-11');
    expect(week.body.occurrences.map((o: { title: string }) => o.title)).toEqual(['Bloque de A']);

    // B has a class 09:00–10:00 on that same day: A planning the same hour must see no conflict.
    const dry = await a.agent
      .post('/api/schedule?dryRun=true')
      .send(block({ title: 'Mismo horario que B', startTime: '09:00', endTime: '10:00' }));
    expect(dry.status).toBe(200);
    expect(dry.body.warnings).toEqual([]);
    expect(JSON.stringify(dry.body)).not.toContain('Bloque de B');
  });

  it('a brand new user sees an empty agenda', async () => {
    await twoUsers();
    const c = await setupUser(app, 'c@example.com');
    expect(
      (await c.agent.get('/api/schedule?from=2026-10-05&to=2026-10-11')).body.occurrences,
    ).toEqual([]);
  });

  it('a client-sent userId can neither create data for B nor reassign A’s data', async () => {
    const { a, b, blockA } = await twoUsers();
    const before = await snapshot();
    const forB = await post(a.agent, block({ title: 'Para B', userId: b.user.id }));
    const steal = await a.agent.patch(`/api/schedule/${blockA.id}`).send({ userId: b.user.id });
    expect(forB.status).toBe(400);
    expect(steal.status).toBe(400);
    expect(await snapshot()).toEqual(before);
    expect(
      (await prisma.scheduleBlock.findUniqueOrThrow({ where: { id: blockA.id } })).userId,
    ).toBe(a.user.id);
  });

  it('works symmetrically: B cannot touch A either', async () => {
    const { a, b, blockA } = await twoUsers();
    const before = await snapshot();
    expect((await b.agent.get(`/api/schedule/${blockA.id}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/schedule/${blockA.id}`).send({ title: 'x' })).status).toBe(
      404,
    );
    expect((await b.agent.delete(`/api/schedule/${blockA.id}`)).status).toBe(404);
    expect((await post(b.agent, block({ subjectId: a.subject.id }))).status).toBe(404);
    expect((await post(b.agent, block({ periodId: a.period.id }))).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('B cannot delete A’s subject or period through the new dependency rules (404, nothing revealed)', async () => {
    const { a, b } = await twoUsers();
    const before = await snapshot();
    const subject = await b.agent.delete(`/api/subjects/${a.subject.id}`);
    const period = await b.agent.delete(`/api/periods/${a.period.id}`);
    expect(subject.status).toBe(404); // not 409: A's blocks and activities stay private
    expect(period.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });
});
