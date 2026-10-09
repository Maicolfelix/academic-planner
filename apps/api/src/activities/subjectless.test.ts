import { randomUUID } from 'node:crypto';
import {
  dashboardResponseSchema,
  dueRemindersResponseSchema,
  progressResponseSchema,
  radarResponseSchema,
  workloadResponseSchema,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, postActivity, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

// F1: an activity always belongs to a period; its subject is optional. "Now" is Monday 5 October 2026, 12:00 in Bogotá.
const NOW = new Date('2026-10-05T17:00:00.000Z');
let now = NOW;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = NOW;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

/** A general activity: no subjectId at all. */
const general = (agent: request.Agent, body: object = {}) =>
  agent
    .post('/api/activities')
    .send({ title: 'Renovar matrícula', dueDate: '2099-03-15', ...body });

const patch = (agent: request.Agent, id: string, body: object) =>
  agent.patch(`/api/activities/${id}`).send(body);

/** The user with a current period + subject, plus a SECOND (non-current) period holding its own subject. */
async function twoPeriods(email = 'a@example.com') {
  const a = await setupUser(app, email, 'Redes');
  const other = (
    await a.agent.post('/api/periods').send({
      name: 'Semestre siguiente',
      startDate: '2027-02-01',
      endDate: '2027-06-01',
      isCurrent: false,
    })
  ).body.period;
  const otherSubject = (
    await a.agent.post('/api/subjects').send({ periodId: other.id, name: 'Cálculo' })
  ).body.subject;
  return { ...a, other, otherSubject };
}

const row = (id: string) => prisma.activity.findUniqueOrThrow({ where: { id } });

describe('POST /api/activities — the period is derived by the server', () => {
  it('with a subject: the activity takes the SUBJECT’s period (behaviour unchanged for existing clients)', async () => {
    const a = await twoPeriods();
    const res = await postActivity(a.agent, a.otherSubject.id); // a subject of the NON-current period
    expect(res.status).toBe(201);
    expect(res.body.activity.subjectId).toBe(a.otherSubject.id);
    expect((await row(res.body.activity.id)).periodId).toBe(a.other.id);
  });

  it.each([
    ['omitted', {}],
    ['null', { subjectId: null }],
  ])(
    'without a subject (%s): a general activity anchored to the CURRENT period',
    async (_l, extra) => {
      const a = await twoPeriods();
      const res = await general(a.agent, extra);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.activity.subjectId).toBeNull();
      const stored = await row(res.body.activity.id);
      expect(stored.periodId).toBe(a.period.id); // the current one, not the other period
      expect(stored.userId).toBe(a.user.id);
      expect(stored.subjectId).toBeNull();
    },
  );

  it('the period is not part of the public contract (the client neither sends nor reads it)', async () => {
    const a = await twoPeriods();
    const created = await general(a.agent);
    expect(created.body.activity).not.toHaveProperty('periodId');
    expect(
      (await a.agent.get(`/api/activities/${created.body.activity.id}`)).body.activity,
    ).not.toHaveProperty('periodId');
    expect((await a.agent.get('/api/activities')).body.activities[0]).not.toHaveProperty(
      'periodId',
    );
  });

  it('a general activity gets its automatic reminders in the same transaction, like any other', async () => {
    const a = await twoPeriods();
    const res = await general(a.agent, { type: 'EXAM', dueDate: '2026-12-01' });
    const reminders = (await a.agent.get(`/api/reminders?activityId=${res.body.activity.id}`)).body
      .reminders as { kind: string }[];
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every((r) => r.kind === 'AUTO')).toBe(true);
  });

  it('without a current period there is nothing to anchor it to: NO_CURRENT_PERIOD, nothing is stored', async () => {
    const { agent } = await signUp(app, 'noperiod@example.com');
    const res = await general(agent);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
    expect(await prisma.activity.count()).toBe(0);
  });

  it('a foreign or unknown subject is the very same 404; a foreign period is never reachable', async () => {
    const a = await twoPeriods();
    const b = await twoPeriods('b@example.com');
    const foreign = await postActivity(a.agent, b.subject.id);
    const unknown = await postActivity(a.agent, randomUUID());
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
    expect(await prisma.activity.count()).toBe(0);
  });

  it.each(['periodId', 'userId', 'status', 'completedAt'])(
    'mass assignment: %s in the body is rejected (400) and nothing is stored',
    async (key) => {
      const a = await twoPeriods();
      const b = await twoPeriods('b@example.com');
      const value =
        key === 'status' ? 'COMPLETED' : key === 'completedAt' ? '2026-01-01' : b.period.id;
      expect((await general(a.agent, { [key]: value })).status).toBe(400);
      expect((await postActivity(a.agent, a.subject.id, { [key]: value })).status).toBe(400);
      expect(await prisma.activity.count()).toBe(0);
    },
  );
});

describe('PATCH /api/activities/:id — subject transitions, the period never moves', () => {
  it('subjectId absent: neither the subject nor the period change', async () => {
    const a = await twoPeriods();
    const id = (await postActivity(a.agent, a.subject.id)).body.activity.id as string;
    const before = await row(id);
    const res = await patch(a.agent, id, { title: 'Solo el título' });
    expect(res.status).toBe(200);
    const after = await row(id);
    expect(after.subjectId).toBe(before.subjectId);
    expect(after.periodId).toBe(before.periodId);
  });

  it('subject -> null: allowed, the activity becomes general and KEEPS its period (and its reminders)', async () => {
    const a = await twoPeriods();
    const id = (await postActivity(a.agent, a.subject.id, { type: 'EXAM', dueDate: '2026-12-01' }))
      .body.activity.id as string;
    const remindersBefore = await prisma.reminder.count({ where: { activityId: id } });
    const before = await row(id);

    const res = await patch(a.agent, id, { subjectId: null });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.activity.subjectId).toBeNull();
    const after = await row(id);
    expect(after.subjectId).toBeNull();
    expect(after.periodId).toBe(before.periodId);
    expect(await prisma.reminder.count({ where: { activityId: id } })).toBe(remindersBefore);
  });

  it('null -> subject of the same period: allowed', async () => {
    const a = await twoPeriods();
    const id = (await general(a.agent)).body.activity.id as string;
    const res = await patch(a.agent, id, { subjectId: a.subject.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.activity.subjectId).toBe(a.subject.id);
    expect((await row(id)).periodId).toBe(a.period.id);
  });

  it('subject A -> subject B of the same period: allowed', async () => {
    const a = await twoPeriods();
    const second = (
      await a.agent.post('/api/subjects').send({ periodId: a.period.id, name: 'Bases' })
    ).body.subject;
    const id = (await postActivity(a.agent, a.subject.id)).body.activity.id as string;
    const res = await patch(a.agent, id, { subjectId: second.id });
    expect(res.status).toBe(200);
    expect((await row(id)).subjectId).toBe(second.id);
  });

  it.each([
    ['subject A -> a subject of ANOTHER period', true],
    ['general -> a subject of ANOTHER period', false],
  ])('%s is rejected (400 VALIDATION_ERROR) and nothing changes', async (_l, withSubject) => {
    const a = await twoPeriods();
    const id = (withSubject ? await postActivity(a.agent, a.subject.id) : await general(a.agent))
      .body.activity.id as string;
    const before = await row(id);
    const res = await patch(a.agent, id, { subjectId: a.otherSubject.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.subjectId[0]).toBe(
      'La asignatura debe pertenecer al mismo periodo.',
    );
    expect(await row(id)).toEqual(before); // not even updatedAt moved
  });

  it('a foreign subject is the same 404 as an unknown one; periodId in the body is rejected', async () => {
    const a = await twoPeriods();
    const b = await twoPeriods('b@example.com');
    const id = (await general(a.agent)).body.activity.id as string;
    const foreign = await patch(a.agent, id, { subjectId: b.subject.id });
    const unknown = await patch(a.agent, id, { subjectId: randomUUID() });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
    const mass = await patch(a.agent, id, { periodId: a.other.id });
    expect(mass.status).toBe(400);
    expect((await row(id)).periodId).toBe(a.period.id);
  });
});

describe('GET /api/activities — general activities in lists and filters', () => {
  it('lists them, and subjectId=none / subjectId=<uuid> / periodId select exactly the right ones', async () => {
    const a = await twoPeriods();
    const withSubject = (await postActivity(a.agent, a.subject.id, { title: 'Con asignatura' }))
      .body.activity;
    const g1 = (await general(a.agent, { title: 'General 1' })).body.activity;
    const g2 = (await general(a.agent, { title: 'General 2', dueDate: '2099-04-01' })).body
      .activity;
    const otherPeriod = (await postActivity(a.agent, a.otherSubject.id, { title: 'Otro periodo' }))
      .body.activity;

    const ids = async (qs: string) =>
      ((await a.agent.get(`/api/activities${qs}`)).body.activities as { id: string }[])
        .map((x) => x.id)
        .sort();

    expect(await ids('')).toEqual([withSubject.id, g1.id, g2.id, otherPeriod.id].sort());
    expect(await ids('?subjectId=none')).toEqual([g1.id, g2.id].sort());
    expect(await ids(`?subjectId=${a.subject.id}`)).toEqual([withSubject.id]);
    // The period filter is the stored period: generals are in, and the other period's activity is out.
    expect(await ids(`?periodId=${a.period.id}`)).toEqual([withSubject.id, g1.id, g2.id].sort());
    expect(await ids(`?periodId=${a.other.id}`)).toEqual([otherPeriod.id]);
    // Filters combine with AND.
    expect(await ids('?subjectId=none&status=COMPLETED')).toEqual([]);
  });

  it('any other subjectId value is a 400 (no ambiguous sentinels)', async () => {
    const a = await twoPeriods();
    for (const bad of ['None', 'null', 'all', '123', ''])
      expect((await a.agent.get(`/api/activities?subjectId=${bad}`)).status, bad).toBe(400);
  });

  it('is always scoped by user: B’s general activities and period are invisible to A', async () => {
    const a = await twoPeriods();
    const b = await twoPeriods('b@example.com');
    await general(b.agent, { title: 'Secreta de B' });
    expect((await a.agent.get('/api/activities?subjectId=none')).body.activities).toEqual([]);
    expect((await a.agent.get(`/api/activities?periodId=${b.period.id}`)).body.activities).toEqual(
      [],
    );
  });
});

describe('a foreign general activity answers the same 404 on every route', () => {
  it('GET / PATCH / DELETE / calendar.ics of B’s general activity from A, indistinguishable from an unknown id', async () => {
    const a = await twoPeriods();
    const b = await twoPeriods('b@example.com');
    const id = (await general(b.agent, { title: 'Privada' })).body.activity.id as string;
    const ghost = randomUUID();
    const attempt = (target: string) => [
      a.agent.get(`/api/activities/${target}`),
      patch(a.agent, target, { title: 'HACKED', subjectId: null }),
      a.agent.delete(`/api/activities/${target}`),
      a.agent.get(`/api/activities/${target}/calendar.ics`),
    ];
    const real = await Promise.all(attempt(id));
    const none = await Promise.all(attempt(ghost));
    real.forEach((res, i) => {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(none[i]!.body);
    });
    expect((await row(id)).title).toBe('Privada');
  });
});

describe('deleting subjects and periods', () => {
  it('a subject with activities is still refused (409 SUBJECT_NOT_EMPTY): no cascade, no silent unlink', async () => {
    const a = await twoPeriods();
    const id = (await postActivity(a.agent, a.subject.id)).body.activity.id as string;
    const res = await a.agent.delete(`/api/subjects/${a.subject.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBJECT_NOT_EMPTY');
    expect((await row(id)).subjectId).toBe(a.subject.id);
  });

  it('once the student detaches it on purpose, the subject can go and the activity survives as a general one', async () => {
    const a = await twoPeriods();
    const id = (await postActivity(a.agent, a.subject.id)).body.activity.id as string;
    await patch(a.agent, id, { subjectId: null });
    expect((await a.agent.delete(`/api/subjects/${a.subject.id}`)).status).toBe(204);
    const kept = await row(id);
    expect(kept.subjectId).toBeNull();
    expect(kept.periodId).toBe(a.period.id);
  });

  it('a period whose ONLY content is a general activity can not be deleted: 409 PERIOD_NOT_EMPTY, never a 500', async () => {
    const a = await twoPeriods();
    await a.agent.delete(`/api/subjects/${a.otherSubject.id}`);
    // The "other" period is now empty. Make it current so the general activity lands in it.
    expect(
      (await a.agent.patch(`/api/periods/${a.other.id}`).send({ isCurrent: true })).status,
    ).toBe(200);
    const id = (await general(a.agent)).body.activity.id as string;
    expect((await row(id)).periodId).toBe(a.other.id);

    const res = await a.agent.delete(`/api/periods/${a.other.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_NOT_EMPTY');
    expect(await prisma.academicPeriod.count({ where: { id: a.other.id } })).toBe(1);

    // After deleting the activity, the (now empty, non-current) period can go.
    await a.agent.patch(`/api/periods/${a.period.id}`).send({ isCurrent: true });
    await a.agent.delete(`/api/activities/${id}`);
    expect((await a.agent.delete(`/api/periods/${a.other.id}`)).status).toBe(204);
  });
});

describe('the readers treat a general activity like any other (and subject-bound ones exactly as before)', () => {
  it('Radar classifies by deadline and status only: a general lands in the same group as a subject-bound twin', async () => {
    const a = await twoPeriods();
    const days = ['2026-10-01', '2026-10-06', '2026-10-12', '2026-11-20', '2099-01-01']; // overdue … far
    for (const [i, dueDate] of days.entries()) {
      await postActivity(a.agent, a.subject.id, { title: `Con ${i}`, dueDate });
      await general(a.agent, { title: `Sin ${i}`, dueDate });
    }
    const radar = radarResponseSchema.parse((await a.agent.get('/api/radar')).body).radar;
    const groupOf = (title: string) =>
      Object.entries(radar.groups).find(([, list]) => list.some((x) => x.title === title))?.[0];
    for (const i of days.keys()) {
      expect(groupOf(`Sin ${i}`), `Sin ${i}`).toBeDefined();
      expect(groupOf(`Sin ${i}`)).toBe(groupOf(`Con ${i}`));
    }
    const general0 = radar.groups.overdue.find((x) => x.title === 'Sin 0')!;
    expect(general0.subject).toBeNull();
    expect(radar.groups.overdue.find((x) => x.title === 'Con 0')!.subject).toMatchObject({
      id: a.subject.id,
    });
    // Every open activity of the period is counted exactly once.
    expect(Object.values(radar.summary).reduce((x, y) => x + y, 0)).toBe(10);
  });

  it('Dashboard: counts and lists include the general ones, with subject null', async () => {
    const a = await twoPeriods();
    await postActivity(a.agent, a.subject.id, { title: 'Con', dueDate: '2026-10-06' });
    await general(a.agent, { title: 'Sin vencida', dueDate: '2026-10-01' });
    await general(a.agent, { title: 'Sin hoy', dueDate: '2026-10-05', dueTime: '18:00' });
    await general(a.agent, { title: 'Sin próxima', dueDate: '2026-10-20' });
    const done = (await general(a.agent, { title: 'Sin lista', dueDate: '2026-10-07' })).body
      .activity.id;
    await patch(a.agent, done, { status: 'COMPLETED' });

    const d = dashboardResponseSchema.parse((await a.agent.get('/api/dashboard')).body).dashboard;
    expect(d.summary).toMatchObject({ total: 5, pending: 4, completed: 1, overdue: 1 });
    expect(d.progress).toMatchObject({ total: 5, completed: 1 });
    expect(d.overdue.map((x) => [x.title, x.subject])).toEqual([['Sin vencida', null]]);
    expect(d.today.map((x) => [x.title, x.subject])).toEqual([['Sin hoy', null]]);
    const upcoming = d.upcoming.map((x) => x.title);
    expect(upcoming).toEqual(['Con', 'Sin próxima']);
    expect(d.upcoming[0]!.subject).toMatchObject({ id: a.subject.id });
    expect(d.nextDue?.title).toBe('Sin hoy');
  });

  it('Progress: the general total counts every activity ONCE; subjects’ rows hold only their own (and may add up to less)', async () => {
    const a = await twoPeriods();
    const s2 = (await a.agent.post('/api/subjects').send({ periodId: a.period.id, name: 'Bases' }))
      .body.subject;
    const mk = async (subjectId: string | null, status: string, dueDate = '2099-01-01') => {
      const body = { title: 'x', dueDate };
      const res = subjectId
        ? await postActivity(a.agent, subjectId, body)
        : await general(a.agent, body);
      if (status !== 'PENDING') await patch(a.agent, res.body.activity.id, { status });
    };
    // Redes: 2 pending (1 overdue) + 1 completed. Bases: 1 in progress + 1 completed.
    await mk(a.subject.id, 'PENDING');
    await mk(a.subject.id, 'PENDING', '2026-10-01');
    await mk(a.subject.id, 'COMPLETED');
    await mk(s2.id, 'IN_PROGRESS');
    await mk(s2.id, 'COMPLETED');
    // General: 2 pending (1 overdue), 1 in progress, 1 completed.
    await mk(null, 'PENDING');
    await mk(null, 'PENDING', '2026-10-02');
    await mk(null, 'IN_PROGRESS');
    await mk(null, 'COMPLETED');

    const p = progressResponseSchema.parse((await a.agent.get('/api/progress')).body).progress;
    const total = await prisma.activity.count({ where: { periodId: a.period.id } });
    expect(total).toBe(9);
    expect(p.general).toMatchObject({
      total: 9,
      pending: 4,
      inProgress: 2,
      completed: 3,
      overdue: 2,
    });
    expect(p.general.percentage).toBe(33);

    const redes = p.subjects.find((s) => s.id === a.subject.id)!;
    const bases = p.subjects.find((s) => s.id === s2.id)!;
    expect(redes).toMatchObject({ total: 3, pending: 2, completed: 1, overdue: 1 });
    expect(bases).toMatchObject({ total: 2, inProgress: 1, completed: 1, overdue: 0 });
    // No artificial row: only real subjects, and their rows add up to LESS than the general total (intentional).
    expect(p.subjects.map((s) => s.id).sort()).toEqual([a.subject.id, s2.id].sort());
    const rowsTotal = p.subjects.reduce((n, s) => n + s.total, 0);
    expect(rowsTotal).toBe(5);
    expect(rowsTotal).toBeLessThan(p.general.total);
    // The Dashboard says the same about the whole period.
    const d = dashboardResponseSchema.parse((await a.agent.get('/api/dashboard')).body).dashboard;
    expect(d.progress).toMatchObject({ total: 9, completed: 3 });
  });

  it('Progress with ONLY general activities: a general total and no subject rows with activities', async () => {
    const a = await twoPeriods();
    await general(a.agent);
    await general(a.agent);
    const p = progressResponseSchema.parse((await a.agent.get('/api/progress')).body).progress;
    expect(p.general).toMatchObject({ total: 2, pending: 2, completed: 0 });
    expect(p.subjects.every((s) => s.total === 0)).toBe(true);
  });

  it('Workload: a general activity counts in its day and in the week’s totals, like a subject-bound one', async () => {
    const a = await twoPeriods();
    const week = async () =>
      workloadResponseSchema.parse((await a.agent.get('/api/workload?week=2026-10-05')).body)
        .workload;
    const before = await week();
    await general(a.agent, { dueDate: '2026-10-07' });
    await postActivity(a.agent, a.subject.id, { dueDate: '2026-10-07' });
    const after = await week();
    expect(after.totals.activityCount - before.totals.activityCount).toBe(2);
    expect(after.totals.openActivityCount - before.totals.openActivityCount).toBe(2);
    expect(after.days.find((d) => d.date === '2026-10-07')!.activityCount).toBe(2);
  });

  it('Reminders: a general activity’s due reminders carry subject null and still mark as seen', async () => {
    const a = await twoPeriods();
    await general(a.agent, { title: 'Sin', type: 'EXAM', dueDate: '2026-10-06' });
    await postActivity(a.agent, a.subject.id, {
      title: 'Con',
      type: 'EXAM',
      dueDate: '2026-10-06',
    });
    // The automatic reminders are created for the future; a day later (the day before the deadline) they are due.
    now = new Date('2026-10-06T17:00:00.000Z');
    const due = dueRemindersResponseSchema.parse((await a.agent.get('/api/reminders/due')).body);
    const mine = due.reminders.filter((r) => r.activity.title === 'Sin');
    const twin = due.reminders.filter((r) => r.activity.title === 'Con');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBe(twin.length);
    expect(mine.every((r) => r.subject === null)).toBe(true);
    expect(twin.every((r) => r.subject?.id === a.subject.id)).toBe(true);
    const seen = await a.agent.post('/api/reminders/seen').send({ ids: mine.map((r) => r.id) });
    expect(seen.status).toBe(200);
  });

  it('Calendar export: a general activity downloads with just its title and never asks for a subject', async () => {
    const a = await twoPeriods();
    const id = (await general(a.agent, { title: 'Pagar la matrícula', dueDate: '2026-10-23' })).body
      .activity.id as string;
    const res = await a.agent.get(`/api/activities/${id}/calendar.ics`);
    expect(res.status).toBe(200);
    const summary = res.text.split('\r\n').find((l) => l.startsWith('SUMMARY:'));
    expect(summary).toBe('SUMMARY:Pagar la matrícula');
    expect(res.text).not.toContain('Sin asignatura');
    expect(res.text).not.toContain('—');
  });
});
