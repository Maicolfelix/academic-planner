import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ACTIVITY_TYPES,
  dueRemindersResponseSchema,
  getDefaultReminderOffsets,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  buildApp,
  periodInput,
  postActivity,
  prisma,
  resetDb,
  setupUser,
} from '../../test/helpers.js';

// "Now" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5). The tests move it forward to make reminders due.
const START = new Date('2026-10-05T17:00:00.000Z');
let now = START;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = START;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

type R = {
  id: string;
  kind: string;
  status: string;
  offsetMinutes: number | null;
  remindAt: string;
  activityId: string;
};
type Body = Record<string, unknown>;

const exam = (over: Body = {}): Body => ({
  title: 'Parcial de Redes',
  type: 'EXAM',
  dueDate: '2026-10-12',
  dueTime: '10:00', // Monday 10:00 Bogotá = 15:00Z
  ...over,
});
const reminders = async (agent: request.Agent, activityId: string) =>
  (await agent.get(`/api/reminders?activityId=${activityId}`)).body.reminders as R[];
const auto = (list: R[]) => list.filter((r) => r.kind === 'AUTO');
const offsets = (list: R[]) => list.map((r) => r.offsetMinutes);
const patch = (agent: request.Agent, id: string, body: Body) =>
  agent.patch(`/api/activities/${id}`).send(body);
const due = async (agent: request.Agent) =>
  dueRemindersResponseSchema.parse((await agent.get('/api/reminders/due')).body);
const manual = (agent: request.Agent, activityId: string, remindDate: string, remindTime: string) =>
  agent.post('/api/reminders').send({ activityId, remindDate, remindTime });

async function withExam(over: Body = {}) {
  const ctx = await setupUser(app, 'a@example.com');
  const activity = (await postActivity(ctx.agent, ctx.subject.id, exam(over))).body.activity as {
    id: string;
  };
  return { ...ctx, activity };
}

describe('authentication', () => {
  it('every reminder endpoint requires a session', async () => {
    const id = randomUUID();
    const calls = [
      request(app).get('/api/reminders'),
      request(app).get('/api/reminders/due'),
      request(app)
        .post('/api/reminders')
        .send({ activityId: id, remindDate: '2026-10-10', remindTime: '09:00' }),
      request(app)
        .patch(`/api/reminders/${id}`)
        .send({ remindDate: '2026-10-10', remindTime: '09:00' }),
      request(app).delete(`/api/reminders/${id}`),
      request(app)
        .post('/api/reminders/seen')
        .send({ ids: [id] }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('automatic reminders when an activity is created', () => {
  it.each(ACTIVITY_TYPES)(
    'a %s due in two months gets exactly its default reminders',
    async (type) => {
      const { agent, subject } = await setupUser(app, 'a@example.com');
      const res = await postActivity(agent, subject.id, {
        title: 'x',
        type,
        dueDate: '2026-12-01',
        dueTime: '10:00',
      });
      expect(res.status).toBe(201);

      const list = await reminders(agent, res.body.activity.id);
      expect(offsets(list).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
        [...getDefaultReminderOffsets(type)].sort((a, b) => a - b),
      );
      expect(list.every((r) => r.kind === 'AUTO' && r.status === 'PENDING')).toBe(true);
      const dueAt = Date.parse(res.body.activity.dueAt);
      for (const r of list)
        expect(Date.parse(r.remindAt)).toBe(dueAt + (r.offsetMinutes ?? 0) * 60_000);
    },
  );

  it('an EXAM yields three reminders at the exact Bogotá times, in chronological order', async () => {
    const { agent, activity } = await withExam();
    const list = await reminders(agent, activity.id);
    expect(list.map((r) => [r.offsetMinutes, r.remindAt])).toEqual([
      [-4320, '2026-10-09T15:00:00.000Z'], // Friday 10:00
      [-1440, '2026-10-11T15:00:00.000Z'], // Sunday 10:00
      [-180, '2026-10-12T12:00:00.000Z'], // Monday 07:00
    ]);
  });

  it('creating the activity needs nothing about reminders: the body stays the same', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id, exam());
    expect(res.status).toBe(201);
    expect(res.body.activity.reminders).toBeUndefined();
    const withReminders = await postActivity(agent, subject.id, { ...exam(), reminders: [] });
    expect(withReminders.status).toBe(400); // strict: reminders are not part of the activity input
  });

  it('only the reminders that still lie in the future are created', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    // Due tomorrow 14:00: 3 days before is gone, 1 day before is today 14:00 (> now 12:00), 3 hours before is tomorrow 11:00.
    const tomorrow = await postActivity(
      agent,
      subject.id,
      exam({ dueDate: '2026-10-06', dueTime: '14:00' }),
    );
    expect(offsets(await reminders(agent, tomorrow.body.activity.id))).toEqual([-1440, -180]);
    // Due in 5 hours: only "3 hours before".
    const soon = await postActivity(
      agent,
      subject.id,
      exam({ title: 'pronto', dueDate: '2026-10-05', dueTime: '17:00' }),
    );
    expect(offsets(await reminders(agent, soon.body.activity.id))).toEqual([-180]);
    // Due in 2 hours: nothing makes sense any more.
    const verySoon = await postActivity(
      agent,
      subject.id,
      exam({ title: 'muy pronto', dueDate: '2026-10-05', dueTime: '14:00' }),
    );
    expect(await reminders(agent, verySoon.body.activity.id)).toEqual([]);
  });

  it('an activity that is already overdue gets no reminders (and never a PENDING one in the past)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id, exam({ dueDate: '2026-10-01' }));
    expect(res.status).toBe(201);
    expect(await reminders(agent, res.body.activity.id)).toEqual([]);
    expect(
      await prisma.reminder.count({ where: { status: 'PENDING', remindAt: { lte: now } } }),
    ).toBe(0);
  });

  it('without a time, "1 day before" is 23:59 of the previous local day (the deadline is the end of the day)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await postActivity(agent, subject.id, {
      title: 'Lectura',
      type: 'READING',
      dueDate: '2026-10-16',
    }); // Friday, no time
    const [reminder] = await reminders(agent, res.body.activity.id);
    expect(res.body.activity.dueAt).toBe('2026-10-17T04:59:59.999Z'); // Friday 23:59:59.999 Bogotá
    expect(reminder!.remindAt).toBe('2026-10-16T04:59:59.999Z'); // Thursday 23:59:59.999 Bogotá
  });

  it('uses the user’s timezone to place the deadline the reminders hang from', async () => {
    const { agent, user, subject } = await setupUser(app, 'nz@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Pacific/Auckland' } });
    const res = await postActivity(
      agent,
      subject.id,
      exam({ dueDate: '2026-10-12', dueTime: '10:00' }),
    ); // 10:00 at UTC+13
    expect(res.body.activity.dueAt).toBe('2026-10-11T21:00:00.000Z');
    const last = (await reminders(agent, res.body.activity.id)).at(-1)!;
    expect(last.remindAt).toBe('2026-10-11T18:00:00.000Z'); // 3 hours before: 07:00 in Auckland
  });

  it('is transactional: if the reminders cannot be written, the activity is not created either', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await failReminderInserts(async () => {
      const res = await postActivity(agent, subject.id, exam());
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
    expect(await prisma.activity.count()).toBe(0);
    expect(await prisma.reminder.count()).toBe(0);
    expect((await postActivity(agent, subject.id, exam())).status).toBe(201); // and it works again afterwards
  });
});

describe('changing a type or a deadline recomputes the AUTO reminders and keeps the MANUAL ones', () => {
  it('TASK -> EXAM swaps the AUTO set for the EXAM rules; the manual reminder is untouched', async () => {
    const { agent, activity } = await withExam({ type: 'TASK' });
    expect(offsets(await reminders(agent, activity.id))).toEqual([-1440, -180]);
    const m = (await manual(agent, activity.id, '2026-10-08', '09:00')).body.reminder as R;

    expect((await patch(agent, activity.id, { type: 'EXAM' })).status).toBe(200);
    const after = await reminders(agent, activity.id);
    expect(offsets(auto(after))).toEqual([-4320, -1440, -180]);
    const kept = after.find((r) => r.id === m.id)!;
    expect(kept).toMatchObject({
      kind: 'MANUAL',
      status: 'PENDING',
      remindAt: m.remindAt,
      offsetMinutes: null,
    });
  });

  it('a new deadline moves every AUTO reminder; none is left with the old date; manual stays', async () => {
    const { agent, activity } = await withExam();
    const m = (await manual(agent, activity.id, '2026-10-08', '09:00')).body.reminder as R;
    const before = await reminders(agent, activity.id);

    await patch(agent, activity.id, { dueDate: '2026-10-19' }).expect(200); // one week later, same time
    const after = await reminders(agent, activity.id);

    expect(auto(after).map((r) => r.remindAt)).toEqual([
      '2026-10-16T15:00:00.000Z',
      '2026-10-18T15:00:00.000Z',
      '2026-10-19T12:00:00.000Z',
    ]);
    const oldTimes = new Set(auto(before).map((r) => r.remindAt));
    expect(auto(after).some((r) => oldTimes.has(r.remindAt))).toBe(false);
    expect(after.find((r) => r.id === m.id)!.remindAt).toBe(m.remindAt);
    expect(after).toHaveLength(4); // 3 AUTO + 1 MANUAL, no duplicates
  });

  it('moving the deadline to the date-only form, or changing only the time, recomputes too', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { dueTime: '18:00' }).expect(200);
    expect((await reminders(agent, activity.id)).at(-1)!.remindAt).toBe('2026-10-12T20:00:00.000Z'); // 3 h before 18:00
    await patch(agent, activity.id, { dueTime: null }).expect(200); // back to the end of the day
    expect((await reminders(agent, activity.id)).at(-1)!.remindAt).toBe('2026-10-13T01:59:59.999Z'); // 3 h before 23:59:59.999
  });

  it('moving the deadline closer drops the AUTO reminders that no longer make sense', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { dueDate: '2026-10-05', dueTime: '14:00' }).expect(200); // in 2 hours
    expect(await reminders(agent, activity.id)).toEqual([]);
  });

  it('moving the deadline into the past also leaves no reminders', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { dueDate: '2026-10-01' }).expect(200);
    expect(await reminders(agent, activity.id)).toEqual([]);
  });

  it('is transactional: if the reminders cannot be rewritten, the activity change is rolled back', async () => {
    const { agent, activity } = await withExam();
    const before = await prisma.activity.findUniqueOrThrow({ where: { id: activity.id } });
    const remindersBefore = await prisma.reminder.findMany({ orderBy: { remindAt: 'asc' } });

    await failReminderInserts(async () => {
      const res = await patch(agent, activity.id, { dueDate: '2026-10-19' });
      expect(res.status).toBe(500);
    });

    const after = await prisma.activity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(after.dueAt).toEqual(before.dueAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await prisma.reminder.findMany({ orderBy: { remindAt: 'asc' } })).toEqual(
      remindersBefore,
    ); // nothing deleted
  });
});

describe('only dueAt, type and finishing matter: other edits leave reminders alone', () => {
  it('title, description, priority and subject do not touch a single reminder', async () => {
    const { agent, period, activity } = await withExam();
    await manual(agent, activity.id, '2026-10-08', '09:00').expect(201);
    const snapshot = await prisma.reminder.findMany({ orderBy: [{ remindAt: 'asc' }] });
    const other = (await agent.post('/api/subjects').send({ periodId: period.id, name: 'Otra' }))
      .body.subject;

    await patch(agent, activity.id, {
      title: 'Nuevo título',
      description: 'x',
      priority: 'HIGH',
      subjectId: other.id,
    }).expect(200);
    expect(await prisma.reminder.findMany({ orderBy: [{ remindAt: 'asc' }] })).toEqual(snapshot); // same ids, same updatedAt
  });

  it('PENDING <-> IN_PROGRESS changes nothing either', async () => {
    const { agent, activity } = await withExam();
    const snapshot = await prisma.reminder.findMany({ orderBy: [{ remindAt: 'asc' }] });
    await patch(agent, activity.id, { status: 'IN_PROGRESS' }).expect(200);
    await patch(agent, activity.id, { status: 'PENDING' }).expect(200);
    expect(await prisma.reminder.findMany({ orderBy: [{ remindAt: 'asc' }] })).toEqual(snapshot);
  });

  it('an AUTO reminder the student deleted stays deleted when the activity is merely renamed, and returns only on a relevant change', async () => {
    const { agent, activity } = await withExam();
    const list = await reminders(agent, activity.id);
    const threeHours = list.find((r) => r.offsetMinutes === -180)!;
    await agent.delete(`/api/reminders/${threeHours.id}`).expect(204);

    await patch(agent, activity.id, { title: 'Renombrado' }).expect(200);
    await patch(agent, activity.id, { priority: 'LOW' }).expect(200);
    expect(offsets(await reminders(agent, activity.id))).toEqual([-4320, -1440]); // still gone

    await patch(agent, activity.id, { dueDate: '2026-10-13' }).expect(200); // a relevant change: rules apply again
    expect(offsets(await reminders(agent, activity.id))).toEqual([-4320, -1440, -180]);
  });

  it('the message is derived from the activity, so a renamed activity renames its reminders', async () => {
    const { agent, activity } = await withExam();
    now = new Date('2026-10-09T15:00:01.000Z'); // the 3-days-before reminder is now due
    expect((await due(agent)).reminders[0]!.activity.title).toBe('Parcial de Redes');
    await patch(agent, activity.id, { title: 'Parcial final de Redes' }).expect(200);
    expect((await due(agent)).reminders[0]!.activity.title).toBe('Parcial final de Redes');
  });
});

describe('finishing and reopening', () => {
  it('COMPLETED cancels every PENDING reminder (kept as CANCELLED) and nothing is due any more', async () => {
    const { agent, activity } = await withExam();
    await manual(agent, activity.id, '2026-10-08', '09:00').expect(201);
    now = new Date('2026-10-09T15:00:01.000Z');
    expect((await due(agent)).total).toBe(2); // the 3-days AUTO and the manual one (8 Oct) are both due

    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);
    const list = await reminders(agent, activity.id);
    expect(list).toHaveLength(4); // kept for traceability
    expect(list.every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(await due(agent)).toMatchObject({ reminders: [], total: 0 });
  });

  it('a SHOWN reminder stays SHOWN when the activity is completed', async () => {
    const { agent, activity } = await withExam();
    now = new Date('2026-10-09T15:00:01.000Z');
    const [first] = (await due(agent)).reminders;
    await agent
      .post('/api/reminders/seen')
      .send({ ids: [first!.id] })
      .expect(200);
    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);
    const list = await reminders(agent, activity.id);
    expect(list.find((r) => r.id === first!.id)!.status).toBe('SHOWN');
    expect(list.filter((r) => r.status === 'CANCELLED')).toHaveLength(2);
  });

  it('reopening regenerates the AUTO reminders that are still in the future, and never revives past ones', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);
    now = new Date('2026-10-11T16:00:00.000Z'); // after the 3-days and 1-day reminders; only "3 hours before" is ahead

    await patch(agent, activity.id, { status: 'IN_PROGRESS' }).expect(200);
    const list = await reminders(agent, activity.id);
    expect(list.map((r) => [r.kind, r.offsetMinutes, r.status])).toEqual([
      ['AUTO', -180, 'PENDING'],
    ]);
    expect(
      await prisma.reminder.count({ where: { status: 'PENDING', remindAt: { lte: now } } }),
    ).toBe(0);
  });

  it('reopening to PENDING works the same, with a fresh set after a long time too', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);
    await patch(agent, activity.id, { status: 'PENDING' }).expect(200); // same instant: everything is still ahead
    expect(offsets(await reminders(agent, activity.id))).toEqual([-4320, -1440, -180]);
    expect((await reminders(agent, activity.id)).every((r) => r.status === 'PENDING')).toBe(true);
  });

  it('reopening revives manual reminders that are still ahead, but not the ones whose time passed', async () => {
    const { agent, activity } = await withExam();
    const future = (await manual(agent, activity.id, '2026-10-11', '08:00')).body.reminder as R; // Sunday 08:00
    const soon = (await manual(agent, activity.id, '2026-10-06', '08:00')).body.reminder as R; // Tuesday 08:00
    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);

    now = new Date('2026-10-07T00:00:00.000Z'); // Tuesday 19:00 Bogotá wait: Oct 6 19:00 — after "soon", before "future"
    await patch(agent, activity.id, { status: 'PENDING' }).expect(200);

    const list = await reminders(agent, activity.id);
    expect(list.find((r) => r.id === future.id)!.status).toBe('PENDING'); // revived
    expect(list.find((r) => r.id === soon.id)!.status).toBe('CANCELLED'); // its time is gone
  });

  it('changing the deadline of a completed activity creates no reminders', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);
    const before = await prisma.reminder.findMany({ orderBy: { remindAt: 'asc' } });
    await patch(agent, activity.id, { dueDate: '2026-11-20', type: 'PROJECT' }).expect(200);
    expect(await prisma.reminder.findMany({ orderBy: { remindAt: 'asc' } })).toEqual(before);
  });

  it('reopening with a new deadline in the same request uses the new deadline', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);
    await patch(agent, activity.id, { status: 'PENDING', dueDate: '2026-10-19' }).expect(200);
    expect((await reminders(agent, activity.id)).map((r) => r.remindAt)).toEqual([
      '2026-10-16T15:00:00.000Z',
      '2026-10-18T15:00:00.000Z',
      '2026-10-19T12:00:00.000Z',
    ]);
  });

  it('deleting the activity deletes its reminders (cascade) and only its own', async () => {
    const { agent, subject, activity } = await withExam();
    const other = (await postActivity(agent, subject.id, exam({ title: 'Otra' }))).body.activity;
    await manual(agent, activity.id, '2026-10-08', '09:00').expect(201);
    expect(await prisma.reminder.count({ where: { activityId: activity.id } })).toBe(4);

    await agent.delete(`/api/activities/${activity.id}`).expect(204);
    expect(await prisma.reminder.count({ where: { activityId: activity.id } })).toBe(0);
    expect(await prisma.reminder.count({ where: { activityId: other.id } })).toBe(3);
  });
});

describe('manual reminders', () => {
  it('creates one from a local date and time (converted with the user’s timezone)', async () => {
    const { agent, user, activity } = await withExam();
    const res = await manual(agent, activity.id, '2026-10-08', '09:30');
    expect(res.status).toBe(201);
    expect(res.body.reminder).toMatchObject({
      activityId: activity.id,
      kind: 'MANUAL',
      status: 'PENDING',
      offsetMinutes: null,
      remindAt: '2026-10-08T14:30:00.000Z', // 09:30 Bogotá
    });
    const row = await prisma.reminder.findUniqueOrThrow({ where: { id: res.body.reminder.id } });
    expect(row.userId).toBe(user.id);
  });

  it('rejects a time at or after the deadline, and a time in the past', async () => {
    const { agent, activity } = await withExam(); // due Monday 12 Oct 10:00
    const after = await manual(agent, activity.id, '2026-10-12', '11:00');
    const equal = await manual(agent, activity.id, '2026-10-12', '10:00');
    const past = await manual(agent, activity.id, '2026-10-05', '11:00'); // before now (12:00)
    for (const res of [after, equal, past]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fields.remindTime).toBeDefined();
    }
    expect(after.body.error.details.fields.remindTime[0]).toContain('anterior a la fecha límite');
    expect(past.body.error.details.fields.remindTime[0]).toContain('futuro');
    expect(await prisma.reminder.count({ where: { kind: 'MANUAL' } })).toBe(0);
    // One minute before the deadline is fine.
    expect((await manual(agent, activity.id, '2026-10-12', '09:59')).status).toBe(201);
  });

  it.each([
    ['impossible date', { remindDate: '2026-02-30', remindTime: '09:00' }],
    ['bad time', { remindDate: '2026-10-08', remindTime: '9:00' }],
    ['missing time', { remindDate: '2026-10-08' }],
    ['userId in the body', { remindDate: '2026-10-08', remindTime: '09:00', userId: randomUUID() }],
    ['kind in the body', { remindDate: '2026-10-08', remindTime: '09:00', kind: 'AUTO' }],
    ['status in the body', { remindDate: '2026-10-08', remindTime: '09:00', status: 'SHOWN' }],
    [
      'remindAt in the body',
      { remindDate: '2026-10-08', remindTime: '09:00', remindAt: '2026-10-08T14:00:00Z' },
    ],
  ])('rejects %s', async (_l, body) => {
    const { agent, activity } = await withExam();
    const res = await agent.post('/api/reminders').send({ activityId: activity.id, ...body });
    expect(res.status).toBe(400);
    expect(await prisma.reminder.count({ where: { kind: 'MANUAL' } })).toBe(0);
  });

  it('refuses reminders for a finished activity (409) — and for one that is not the user’s (404)', async () => {
    const { agent, activity } = await withExam();
    await patch(agent, activity.id, { status: 'COMPLETED' }).expect(200);
    const res = await manual(agent, activity.id, '2026-10-08', '09:00');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVITY_COMPLETED');
  });

  it('editing an AUTO reminder turns it into MANUAL, so a later recalculation cannot overwrite it', async () => {
    const { agent, activity } = await withExam();
    const target = (await reminders(agent, activity.id)).find((r) => r.offsetMinutes === -1440)!;

    const res = await agent
      .patch(`/api/reminders/${target.id}`)
      .send({ remindDate: '2026-10-10', remindTime: '18:00' });
    expect(res.status).toBe(200);
    expect(res.body.reminder).toMatchObject({
      id: target.id,
      kind: 'MANUAL',
      offsetMinutes: null,
      remindAt: '2026-10-10T23:00:00.000Z',
    });

    await patch(agent, activity.id, { dueDate: '2026-10-19' }).expect(200); // recalculation
    const after = await reminders(agent, activity.id);
    expect(after.find((r) => r.id === target.id)).toMatchObject({
      kind: 'MANUAL',
      remindAt: '2026-10-10T23:00:00.000Z',
    });
    expect(offsets(auto(after))).toEqual([-4320, -1440, -180]); // a fresh AUTO set coexists with it
  });

  it('editing re-validates, re-arms a SHOWN reminder, and does not apply an invalid time', async () => {
    const { agent, activity } = await withExam();
    now = new Date('2026-10-09T15:00:01.000Z');
    const [shown] = (await due(agent)).reminders;
    await agent
      .post('/api/reminders/seen')
      .send({ ids: [shown!.id] })
      .expect(200);

    const bad = await agent
      .patch(`/api/reminders/${shown!.id}`)
      .send({ remindDate: '2026-10-12', remindTime: '10:00' });
    expect(bad.status).toBe(400);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: shown!.id } })).status).toBe(
      'SHOWN',
    );

    const ok = await agent
      .patch(`/api/reminders/${shown!.id}`)
      .send({ remindDate: '2026-10-11', remindTime: '20:00' });
    expect(ok.body.reminder).toMatchObject({ status: 'PENDING', kind: 'MANUAL' });
    expect(activity.id).toBe(ok.body.reminder.activityId);
  });

  it('deletes a reminder (manual or AUTO); a second delete is 404', async () => {
    const { agent, activity } = await withExam();
    const [first] = await reminders(agent, activity.id);
    expect((await agent.delete(`/api/reminders/${first!.id}`)).status).toBe(204);
    expect((await agent.delete(`/api/reminders/${first!.id}`)).status).toBe(404);
    expect(await reminders(agent, activity.id)).toHaveLength(2);
  });

  it('lists by activity, by status, and orders by time', async () => {
    const { agent, activity } = await withExam();
    await manual(agent, activity.id, '2026-10-06', '08:00').expect(201);
    const all = await reminders(agent, activity.id);
    expect(all.map((r) => r.remindAt)).toEqual([...all.map((r) => r.remindAt)].sort());
    const pending = (await agent.get('/api/reminders?status=PENDING')).body.reminders as R[];
    expect(pending).toHaveLength(4);
    expect((await agent.get('/api/reminders?status=SHOWN')).body.reminders).toEqual([]);
    expect((await agent.get('/api/reminders?status=NOPE')).status).toBe(400);
    expect((await agent.get('/api/reminders?activityId=nope')).status).toBe(400);
  });
});

describe('GET /api/reminders/due', () => {
  it('returns PENDING reminders whose time has come, oldest first, with activity and subject', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const a = (
      await postActivity(agent, subject.id, exam({ title: 'Primero', dueDate: '2026-10-12' }))
    ).body.activity;
    const b = (
      await postActivity(agent, subject.id, exam({ title: 'Segundo', dueDate: '2026-10-13' }))
    ).body.activity;
    expect((await due(agent)).total).toBe(0); // nothing is due yet

    now = new Date('2026-10-10T16:00:00.000Z'); // Saturday: both 3-days-before reminders (Fri 15:00Z / Sat 15:00Z) passed
    const res = await due(agent);
    expect(res.total).toBe(2);
    expect(res.reminders.map((r) => r.activity.title)).toEqual(['Primero', 'Segundo']); // oldest first
    expect(res.reminders[0]).toMatchObject({
      kind: 'AUTO',
      status: 'PENDING',
      offsetMinutes: -4320,
      activity: { id: a.id, title: 'Primero', type: 'EXAM', hasTime: true },
      subject: { id: subject.id, name: 'Redes' },
    });
    expect(res.reminders[1]!.activity.id).toBe(b.id);
  });

  it('reading never changes anything: calling it twice gives the same answer and the rows stay PENDING', async () => {
    const { agent } = await withExam();
    now = new Date('2026-10-10T16:00:00.000Z');
    const first = await due(agent);
    const second = await due(agent);
    expect(second).toEqual(first);
    expect(await prisma.reminder.count({ where: { status: 'PENDING' } })).toBe(3);
  });

  it('shows at most 20, reports the real total, and the oldest are the ones shown', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    for (let i = 0; i < 25; i++) {
      await postActivity(agent, subject.id, {
        title: `Lectura ${String(i).padStart(2, '0')}`,
        type: 'READING',
        dueDate: '2026-10-20',
        dueTime: '10:00',
      });
    }
    now = new Date('2026-10-19T16:00:00.000Z'); // each READING's "1 day before" (19th 15:00Z) is due
    const res = await due(agent);
    expect(res.total).toBe(25);
    expect(res.reminders).toHaveLength(20);
    expect(res.reminders[0]!.activity.title).toBe('Lectura 00'); // equal times: creation order
  });

  it('excludes SHOWN, CANCELLED, future and finished-activity reminders, and other periods and users', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');

    const mine = (await postActivity(a.agent, a.subject.id, exam({ title: 'Mía' }))).body.activity;
    const finished = (await postActivity(a.agent, a.subject.id, exam({ title: 'Finalizada' }))).body
      .activity;
    await postActivity(b.agent, b.subject.id, exam({ title: 'De B' })).expect(201);

    // An activity in ANOTHER period of the same user.
    const old = (
      await a.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Anterior', startDate: '2026-01-15', endDate: '2026-06-30' })
    ).body.period;
    const oldSubject = (
      await a.agent.post('/api/subjects').send({ periodId: old.id, name: 'Vieja' })
    ).body.subject;
    await postActivity(a.agent, oldSubject.id, exam({ title: 'Otro periodo' })).expect(201);

    now = new Date('2026-10-10T16:00:00.000Z');
    await patch(a.agent, finished.id, { status: 'COMPLETED' }).expect(200);
    const res = await due(a.agent);
    expect(res.reminders.map((r) => r.activity.title)).toEqual(['Mía']); // not B's, not the other period's, not the finished one
    expect(res.total).toBe(1);

    await a.agent
      .post('/api/reminders/seen')
      .send({ ids: [res.reminders[0]!.id] })
      .expect(200);
    expect((await due(a.agent)).total).toBe(0); // SHOWN is gone
    expect(mine.id).toBeDefined();
  });

  it('the backend also hides reminders of a finished activity if an inconsistent row ever existed', async () => {
    const { agent, activity } = await withExam();
    now = new Date('2026-10-10T16:00:00.000Z');
    await prisma.activity.update({
      where: { id: activity.id },
      data: { status: 'COMPLETED', completedAt: now },
    }); // bypasses the service
    expect(
      await prisma.reminder.count({ where: { status: 'PENDING', activityId: activity.id } }),
    ).toBeGreaterThan(0);
    expect((await due(agent)).total).toBe(0);
  });

  it('a user with no current period gets an empty answer, not an error', async () => {
    const { signUp } = await import('../../test/helpers.js');
    const { agent } = await signUp(app, 'noperiod@example.com');
    expect(await due(agent)).toEqual({ reminders: [], total: 0 });
  });

  it('is never cached', async () => {
    const { agent } = await withExam();
    expect((await agent.get('/api/reminders/due')).headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/reminders/seen', () => {
  async function twoDue() {
    const ctx = await withExam();
    now = new Date('2026-10-11T16:00:00.000Z'); // the 3-days and 1-day reminders are due
    const { reminders: list } = await due(ctx.agent);
    expect(list).toHaveLength(2);
    return { ...ctx, ids: list.map((r) => r.id) };
  }

  it('marks the given due reminders as SHOWN, and only those', async () => {
    const { agent, ids, activity } = await twoDue();
    const res = await agent.post('/api/reminders/seen').send({ ids: [ids[0]] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    const list = await reminders(agent, activity.id);
    expect(list.filter((r) => r.status === 'SHOWN')).toHaveLength(1);
    expect(list.filter((r) => r.status === 'PENDING')).toHaveLength(2); // the other due one and the future one
    expect((await due(agent)).reminders.map((r) => r.id)).toEqual([ids[1]]);
  });

  it('marks several at once and is idempotent', async () => {
    const { agent, ids } = await twoDue();
    expect((await agent.post('/api/reminders/seen').send({ ids })).body).toEqual({ updated: 2 });
    expect((await agent.post('/api/reminders/seen').send({ ids })).body).toEqual({ updated: 0 });
    expect((await due(agent)).total).toBe(0);
  });

  it('cannot silence a reminder that is not due yet', async () => {
    const { agent, activity } = await withExam();
    const future = (await reminders(agent, activity.id))[0]!;
    const res = await agent.post('/api/reminders/seen').send({ ids: [future.id] });
    expect(res.body).toEqual({ updated: 0 });
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: future.id } })).status).toBe(
      'PENDING',
    );
  });

  it('is all-or-nothing: one unknown id gives 404 and nothing at all is marked', async () => {
    const { agent, ids } = await twoDue();
    const res = await agent.post('/api/reminders/seen').send({ ids: [ids[0], randomUUID()] });
    expect(res.status).toBe(404);
    expect(await prisma.reminder.count({ where: { status: 'SHOWN' } })).toBe(0);
  });

  it('validates the body', async () => {
    const { agent } = await twoDue();
    expect((await agent.post('/api/reminders/seen').send({ ids: [] })).status).toBe(400);
    expect((await agent.post('/api/reminders/seen').send({ ids: ['nope'] })).status).toBe(400);
    expect((await agent.post('/api/reminders/seen').send({})).status).toBe(400);
    expect(
      (await agent.post('/api/reminders/seen').send({ ids: [randomUUID()], userId: randomUUID() }))
        .status,
    ).toBe(400);
  });
});

describe('concurrency and uniqueness', () => {
  it('simultaneous deadline changes never leave duplicate or stale AUTO reminders', async () => {
    const { agent, activity } = await withExam();
    const dates = [
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ];
    const results = await Promise.all(
      dates.map((dueDate) => patch(agent, activity.id, { dueDate })),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);

    const row = await prisma.activity.findUniqueOrThrow({ where: { id: activity.id } });
    const list = auto(await reminders(agent, activity.id));
    expect(offsets(list)).toEqual([-4320, -1440, -180]); // exactly one of each
    for (const r of list)
      expect(Date.parse(r.remindAt)).toBe(row.dueAt.getTime() + (r.offsetMinutes ?? 0) * 60_000); // all from the final deadline
  });

  it('a deadline change racing a completion ends in a consistent state, whichever wins', async () => {
    for (let round = 0; round < 6; round++) {
      await resetDb();
      const { agent, activity } = await withExam();
      const results = await Promise.all([
        patch(agent, activity.id, { dueDate: '2026-10-19' }),
        patch(agent, activity.id, { status: 'COMPLETED' }),
        patch(agent, activity.id, { type: 'PROJECT' }),
      ]);
      for (const r of results) expect([200, 400], `round ${round}`).toContain(r.status);

      const row = await prisma.activity.findUniqueOrThrow({ where: { id: activity.id } });
      const rows = await prisma.reminder.findMany({ where: { activityId: activity.id } });
      const autoRows = rows.filter((r) => r.kind === 'AUTO');
      expect(
        new Set(autoRows.map((r) => r.offsetMinutes)).size,
        `round ${round}: duplicate AUTO offsets`,
      ).toBe(autoRows.length);

      if (row.status === 'COMPLETED') {
        expect(
          rows.some((r) => r.status === 'PENDING'),
          `round ${round}: pending reminder on a finished activity`,
        ).toBe(false);
      } else {
        // Not finished: the AUTO set matches the FINAL type and deadline.
        const expected = [...getDefaultReminderOffsets(row.type)].sort((x, y) => x - y);
        expect(
          autoRows.map((r) => r.offsetMinutes).sort((x, y) => (x ?? 0) - (y ?? 0)),
          `round ${round}`,
        ).toEqual(expected);
        for (const r of autoRows)
          expect(r.remindAt.getTime()).toBe(row.dueAt.getTime() + (r.offsetMinutes ?? 0) * 60_000);
      }
    }
  });

  it('a manual reminder cannot sneak onto an activity that is being finished', async () => {
    for (let round = 0; round < 5; round++) {
      await resetDb();
      const { agent, activity } = await withExam();
      const results = await Promise.all([
        patch(agent, activity.id, { status: 'COMPLETED' }),
        manual(agent, activity.id, '2026-10-08', '09:00'),
        manual(agent, activity.id, '2026-10-09', '09:00'),
      ]);
      for (const r of results)
        expect([200, 201, 409], `round ${round}: ${r.status}`).toContain(r.status);
      expect(
        await prisma.reminder.count({ where: { activityId: activity.id, status: 'PENDING' } }),
        `round ${round}`,
      ).toBe(0);
    }
  });

  describe('constraints enforced by the database itself', () => {
    const base = async () => {
      const { agent, user, subject } = await setupUser(app, 'a@example.com');
      const activity = (
        await postActivity(agent, subject.id, {
          title: 'x',
          type: 'READING',
          dueDate: '2099-01-01',
        })
      ).body.activity;
      await prisma.reminder.deleteMany();
      return {
        userId: user.id,
        activityId: activity.id as string,
        remindAt: new Date('2098-12-31T00:00:00Z'),
      };
    };

    it('an activity cannot hold two AUTO reminders with the same offset', async () => {
      const b = await base();
      await prisma.reminder.create({ data: { ...b, kind: 'AUTO', offsetMinutes: -1440 } });
      await expect(
        prisma.reminder.create({ data: { ...b, kind: 'AUTO', offsetMinutes: -1440 } }),
      ).rejects.toThrow();
      await expect(
        prisma.reminder.create({ data: { ...b, kind: 'AUTO', offsetMinutes: -180 } }),
      ).resolves.toBeTruthy();
    });

    it('many MANUAL reminders may share a time, and the uniqueness is per activity', async () => {
      const b = await base();
      await prisma.reminder.create({ data: { ...b, kind: 'MANUAL' } });
      await expect(
        prisma.reminder.create({ data: { ...b, kind: 'MANUAL' } }),
      ).resolves.toBeTruthy();
    });

    it('AUTO needs a negative offset and MANUAL must have none', async () => {
      const b = await base();
      await expect(prisma.reminder.create({ data: { ...b, kind: 'AUTO' } })).rejects.toThrow();
      await expect(
        prisma.reminder.create({ data: { ...b, kind: 'AUTO', offsetMinutes: 60 } }),
      ).rejects.toThrow();
      await expect(
        prisma.reminder.create({ data: { ...b, kind: 'AUTO', offsetMinutes: 0 } }),
      ).rejects.toThrow();
      await expect(
        prisma.reminder.create({ data: { ...b, kind: 'MANUAL', offsetMinutes: -60 } }),
      ).rejects.toThrow();
    });

    it('deleting a user removes their reminders too', async () => {
      const { agent, user, subject } = await setupUser(app, 'z@example.com');
      await postActivity(agent, subject.id, exam()).expect(201);
      expect(await prisma.reminder.count({ where: { userId: user.id } })).toBe(3);
      await prisma.user.delete({ where: { id: user.id } });
      expect(await prisma.reminder.count()).toBe(0);
    });
  });
});

describe('efficiency: the due list is a constant number of queries', () => {
  const queries: string[] = [];
  const logged = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: 'event', level: 'query' }],
  });
  logged.$on('query', (e) => queries.push(e.query));
  const loggedApp = buildApp({ prisma: logged, clock: () => now });
  afterAll(() => logged.$disconnect());

  async function measure(agent: request.Agent) {
    queries.length = 0;
    const started = performance.now();
    const res = await agent.get('/api/reminders/due');
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    return { count: queries.length, ms, body: res.body };
  }

  it('uses the same number of queries for 2 due reminders as for 20 (no query per reminder)', async () => {
    const { agent, subject } = await setupUser(loggedApp, 'perf@example.com');
    for (let i = 0; i < 2; i++)
      await postActivity(agent, subject.id, {
        title: `a${i}`,
        type: 'READING',
        dueDate: '2026-10-20',
        dueTime: '10:00',
      });
    now = new Date('2026-10-19T16:00:00.000Z');
    const small = await measure(agent);

    now = START; // reminders are only generated for the future, so create the rest "before" and move on again
    for (let i = 2; i < 40; i++)
      await postActivity(agent, subject.id, {
        title: `a${i}`,
        type: 'READING',
        dueDate: '2026-10-20',
        dueTime: '10:00',
      });
    now = new Date('2026-10-19T16:00:00.000Z');
    const large = await measure(agent);

    expect(small.body.total).toBe(2);
    expect(large.body.total).toBe(40);
    expect(large.body.reminders).toHaveLength(20);
    expect(large.count).toBe(small.count);
    expect(large.count).toBeLessThanOrEqual(5); // session (1) + current period (1) + list (1) + count (1) [+ lastUsedAt touch]
    console.info(
      `reminders due: ${large.count} queries, ${large.ms.toFixed(0)} ms for 40 due reminders`,
    );
    expect(large.ms).toBeLessThan(1500);
  });
});

/** Temporarily makes every INSERT into "Reminder" fail, to prove the surrounding write is rolled back. */
async function failReminderInserts(run: () => Promise<void>) {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_fail_reminder() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'simulated reminder failure'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER test_fail_reminder BEFORE INSERT ON "Reminder" FOR EACH ROW EXECUTE FUNCTION test_fail_reminder()`,
  );
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_reminder ON "Reminder"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_reminder()`);
  }
}
