import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, postActivity, prisma, resetDb, setupUser } from '../../test/helpers.js';

let now = new Date('2026-10-05T17:00:00.000Z');
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = new Date('2026-10-05T17:00:00.000Z');
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const exam = { title: 'Parcial', type: 'EXAM', dueDate: '2026-10-12', dueTime: '10:00' };

/** Two users, each with an exam (3 AUTO reminders) and a manual reminder; B's are the targets. */
async function twoUsers() {
  const a = await setupUser(app, 'a@example.com', 'Materia A');
  const b = await setupUser(app, 'b@example.com', 'Materia B');
  const activityA = (await postActivity(a.agent, a.subject.id, { ...exam, title: 'Parcial de A' }))
    .body.activity;
  const activityB = (await postActivity(b.agent, b.subject.id, { ...exam, title: 'Parcial de B' }))
    .body.activity;
  const manualB = (
    await b.agent
      .post('/api/reminders')
      .send({ activityId: activityB.id, remindDate: '2026-10-08', remindTime: '09:00' })
  ).body.reminder as { id: string };
  const autoB = await prisma.reminder.findFirstOrThrow({
    where: { activityId: activityB.id, kind: 'AUTO' },
  });
  return { a, b, activityA, activityB, manualB, autoB };
}

const snapshot = async () => ({
  reminders: await prisma.reminder.findMany({ orderBy: [{ remindAt: 'asc' }, { id: 'asc' }] }),
  activities: await prisma.activity.findMany({ orderBy: { title: 'asc' } }),
});

describe('IDOR: user A can never reach user B’s reminders', () => {
  it('PATCH / DELETE / seen on B’s reminders and creating one on B’s activity all fail, leaving the database intact', async () => {
    const { a, activityB, manualB, autoB } = await twoUsers();
    now = new Date('2026-10-11T16:00:00.000Z'); // some of B's reminders are due now
    const before = await snapshot();

    const attempts = {
      'PATCH manual of B': await a.agent
        .patch(`/api/reminders/${manualB.id}`)
        .send({ remindDate: '2026-10-09', remindTime: '10:00' }),
      'PATCH auto of B': await a.agent
        .patch(`/api/reminders/${autoB.id}`)
        .send({ remindDate: '2026-10-09', remindTime: '10:00' }),
      'DELETE manual of B': await a.agent.delete(`/api/reminders/${manualB.id}`),
      'DELETE auto of B': await a.agent.delete(`/api/reminders/${autoB.id}`),
      'seen B reminder': await a.agent.post('/api/reminders/seen').send({ ids: [autoB.id] }),
      'POST on B’s activity': await a.agent
        .post('/api/reminders')
        .send({ activityId: activityB.id, remindDate: '2026-10-09', remindTime: '10:00' }),
    };
    for (const [label, res] of Object.entries(attempts)) {
      expect(res.status, label).toBe(404);
      expect(res.body.error.code, label).toBe('NOT_FOUND');
    }

    // Verified directly in the database, not through the API.
    expect(await snapshot()).toEqual(before);
    expect(await prisma.reminder.count({ where: { status: 'SHOWN' } })).toBe(0);
  });

  it('answers a foreign reminder or activity exactly like a non-existent one (no existence oracle)', async () => {
    const { a, activityB, manualB } = await twoUsers();
    const ghost = randomUUID();
    const pair = async (foreign: request.Test, missing: request.Test) => {
      const [f, m] = await Promise.all([foreign, missing]);
      expect(f.status).toBe(m.status);
      expect(f.body).toEqual(m.body);
    };
    const when = { remindDate: '2026-10-09', remindTime: '10:00' };

    await pair(
      a.agent.patch(`/api/reminders/${manualB.id}`).send(when),
      a.agent.patch(`/api/reminders/${ghost}`).send(when),
    );
    await pair(
      a.agent.delete(`/api/reminders/${manualB.id}`),
      a.agent.delete(`/api/reminders/${ghost}`),
    );
    await pair(
      a.agent.post('/api/reminders/seen').send({ ids: [manualB.id] }),
      a.agent.post('/api/reminders/seen').send({ ids: [ghost] }),
    );
    await pair(
      a.agent.post('/api/reminders').send({ activityId: activityB.id, ...when }),
      a.agent.post('/api/reminders').send({ activityId: ghost, ...when }),
    );
  });

  it('a request mixing A’s own reminder and B’s is rejected whole: A’s one is not touched either', async () => {
    const { a, activityA, manualB } = await twoUsers();
    now = new Date('2026-10-11T16:00:00.000Z');
    const mine = await prisma.reminder.findFirstOrThrow({
      where: { activityId: activityA.id, remindAt: { lte: now } },
    });
    const res = await a.agent.post('/api/reminders/seen').send({ ids: [mine.id, manualB.id] });
    expect(res.status).toBe(404);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe(
      'PENDING',
    );
  });

  it('listings and the due list never include B’s reminders', async () => {
    const { a, activityA, activityB } = await twoUsers();
    now = new Date('2026-10-11T16:00:00.000Z');

    const all = (await a.agent.get('/api/reminders')).body.reminders as { activityId: string }[];
    expect(all.every((r) => r.activityId === activityA.id)).toBe(true);
    const byB = await a.agent.get(`/api/reminders?activityId=${activityB.id}`);
    expect(byB.status).toBe(200);
    expect(byB.body.reminders).toEqual([]); // filtering by B's activity leaks nothing

    const due = (await a.agent.get('/api/reminders/due')).body;
    expect(JSON.stringify(due)).not.toContain('Parcial de B');
    expect(JSON.stringify(due)).not.toContain('Materia B');
  });

  it('a client-sent userId cannot create reminders for B or reassign A’s', async () => {
    const { a, b, activityA } = await twoUsers();
    const before = await snapshot();
    const forB = await a.agent.post('/api/reminders').send({
      activityId: activityA.id,
      remindDate: '2026-10-09',
      remindTime: '10:00',
      userId: b.user.id,
    });
    expect(forB.status).toBe(400);
    const mine = await prisma.reminder.findFirstOrThrow({ where: { activityId: activityA.id } });
    const steal = await a.agent
      .patch(`/api/reminders/${mine.id}`)
      .send({ remindDate: '2026-10-09', remindTime: '10:00', userId: b.user.id });
    expect(steal.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it('works symmetrically, and B’s activity edits never touch A’s reminders', async () => {
    const { a, b, activityA } = await twoUsers();
    const before = await snapshot();
    const mine = await prisma.reminder.findFirstOrThrow({ where: { activityId: activityA.id } });
    expect(
      (
        await b.agent
          .patch(`/api/reminders/${mine.id}`)
          .send({ remindDate: '2026-10-09', remindTime: '10:00' })
      ).status,
    ).toBe(404);
    expect((await b.agent.delete(`/api/reminders/${mine.id}`)).status).toBe(404);
    expect(
      (await b.agent.patch(`/api/activities/${activityA.id}`).send({ dueDate: '2026-11-01' }))
        .status,
    ).toBe(404);
    expect(await snapshot()).toEqual(before);
    expect(a.user.id).toBeDefined();
  });
});
