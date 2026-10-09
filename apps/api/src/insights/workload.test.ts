import { PrismaPg } from '@prisma/adapter-pg';
import { workloadResponseSchema, type Workload } from '@planner/core';
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
  signUp,
} from '../../test/helpers.js';

// "Now" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5): the current local week is 5-11 October.
const NOW = new Date('2026-10-05T17:00:00.000Z');
let now = NOW;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = NOW;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const MONDAY = '2026-10-05';
const WEEK_OF = (date: string) => `/api/workload?week=${date}`;

const getWorkload = async (agent: request.Agent, week?: string): Promise<Workload> => {
  const res = await agent.get(week ? WEEK_OF(week) : '/api/workload');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return workloadResponseSchema.parse(res.body).workload; // also validates the whole shape
};

type Body = Record<string, unknown>;
const block = (over: Body = {}): Body => ({
  type: 'STUDY',
  title: 'Bloque',
  date: '2026-10-06',
  startTime: '14:00',
  endTime: '16:00',
  ...over,
});
const postBlock = async (agent: request.Agent, body: Body) => {
  const res = await agent.post('/api/schedule').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.block as { id: string };
};
const activityOn = async (
  agent: request.Agent,
  subjectId: string,
  date: string,
  opts: { time?: string; status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'; title?: string } = {},
) => {
  const id = (
    await postActivity(agent, subjectId, {
      title: opts.title ?? `Entrega ${date}`,
      dueDate: date,
      dueTime: opts.time ?? '10:00',
    })
  ).body.activity.id as string;
  if (opts.status && opts.status !== 'PENDING') {
    await prisma.activity.update({
      where: { id },
      data: { status: opts.status, completedAt: opts.status === 'COMPLETED' ? NOW : null },
    });
  }
  return id;
};
const dayOf = (w: Workload, weekday: number) => w.days[weekday - 1]!;

describe('GET /api/workload — access and input', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/api/workload');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is never cached', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect((await agent.get('/api/workload')).headers['cache-control']).toBe('no-store');
  });

  it.each(['2026-02-30', 'hoy', '07/10/2026', '2026-13-01', ''])('rejects week=%s', async (bad) => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await agent.get(`/api/workload?week=${encodeURIComponent(bad)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores a userId or periodId in the query string: scope always comes from the session', async () => {
    const a = await setupUser(app, 'a@example.com', 'Materia A');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await activityOn(a.agent, a.subject.id, '2026-10-06');
    await activityOn(b.agent, b.subject.id, '2026-10-06');
    await activityOn(b.agent, b.subject.id, '2026-10-07');
    const res = await a.agent.get(`/api/workload?userId=${b.user.id}&periodId=${b.period.id}`);
    const w = workloadResponseSchema.parse(res.body).workload;
    expect(w.period?.id).toBe(a.period.id);
    expect(w.totals.activityCount).toBe(1);
  });

  it('a user without a period gets an empty week, not an error', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await getWorkload(agent);
    expect(w.period).toBeNull();
    expect(w.week).toEqual({ from: MONDAY, to: '2026-10-11' });
    expect(w.totals.totalCommitments).toBe(0);
    expect(w.days).toHaveLength(7);
    expect(w.busiestDay).toBeNull();
  });
});

describe('the week', () => {
  it('without a parameter it is the user’s LOCAL current week, Monday to Sunday', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const w = await getWorkload(agent);
    expect(w.week).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(w.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(w.days[0]!.date).toBe('2026-10-05');
    expect(w.days[6]!.date).toBe('2026-10-11');
  });

  it('is not the UTC week: Sunday 23:30 in Bogotá is already Monday in UTC, and still the same local week', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    now = new Date('2026-10-12T04:30:00.000Z'); // Sun 11 Oct 23:30 Bogotá = Mon 12 Oct 04:30 UTC
    expect((await getWorkload(agent)).week.from).toBe('2026-10-05');
    now = new Date('2026-10-12T05:00:00.000Z'); // Mon 12 Oct 00:00 Bogotá
    expect((await getWorkload(agent)).week.from).toBe('2026-10-12');
  });

  it('week=<any date> returns the Monday-Sunday week that contains it', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    for (const date of ['2026-10-05', '2026-10-07', '2026-10-11']) {
      expect((await getWorkload(agent, date)).week, date).toEqual({
        from: '2026-10-05',
        to: '2026-10-11',
      });
    }
    expect((await getWorkload(agent, '2026-10-12')).week.from).toBe('2026-10-12');
    expect((await getWorkload(agent, '2026-10-04')).week.from).toBe('2026-09-28');
  });

  it('a week completely outside the period returns zeros: older periods are not pulled in', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await activityOn(agent, subject.id, '2026-10-06');
    const w = await getWorkload(agent, '2027-02-01');
    expect(w.totals.totalCommitments).toBe(0);
    expect(w.days.every((d) => d.totalCommitments === 0)).toBe(true);
    expect(w.busiestDay).toBeNull();
  });
});

describe('a controlled week', () => {
  // Monday: 1 activity + 2 classes (08-10, 10-11:30). Tuesday: 1 study block (14-16).
  // Wednesday: 2 activities (one completed) + 1 class that is a WEEKLY series (08-10).
  async function seed() {
    const ctx = await setupUser(app, 'a@example.com');
    const { agent, subject } = ctx;
    await activityOn(agent, subject.id, '2026-10-05', { title: 'Lunes' });
    await postBlock(
      agent,
      block({
        type: 'CLASS',
        title: 'Redes 1',
        date: '2026-10-05',
        startTime: '08:00',
        endTime: '10:00',
        subjectId: subject.id,
      }),
    );
    await postBlock(
      agent,
      block({
        type: 'CLASS',
        title: 'Redes 2',
        date: '2026-10-05',
        startTime: '10:00',
        endTime: '11:30',
        subjectId: subject.id,
      }),
    );
    await postBlock(
      agent,
      block({
        type: 'STUDY',
        title: 'Estudio',
        date: '2026-10-06',
        startTime: '14:00',
        endTime: '16:00',
      }),
    );
    await activityOn(agent, subject.id, '2026-10-07', { title: 'Miércoles 1' });
    await activityOn(agent, subject.id, '2026-10-07', {
      title: 'Miércoles 2',
      status: 'COMPLETED',
    });
    await postBlock(
      agent,
      block({
        type: 'CLASS',
        title: 'Serie',
        date: '2026-09-09',
        startTime: '08:00',
        endTime: '10:00',
        subjectId: subject.id,
        recurrence: { frequency: 'WEEKLY', until: '2026-11-25' },
      }),
    );
    return ctx;
  }

  it('totals', async () => {
    const { agent } = await seed();
    const w = await getWorkload(agent);
    expect(w.totals).toEqual({
      activityCount: 3,
      activitiesByStatus: { pending: 2, inProgress: 0, completed: 1 },
      openActivityCount: 2,
      classCount: 3,
      studyBlockCount: 1,
      otherAcademicBlockCount: 0,
      scheduleOccurrenceCount: 4,
      totalCommitments: 7,
      scheduledMinutes: 120 + 90 + 120 + 120,
    });
  });

  it('per day and the busiest day (Monday and Wednesday tie on 3: Monday has more scheduled minutes)', async () => {
    const { agent } = await seed();
    const w = await getWorkload(agent);
    expect(
      w.days.map((d) => [d.activityCount, d.scheduleCount, d.scheduledMinutes, d.totalCommitments]),
    ).toEqual([
      [1, 2, 210, 3],
      [0, 1, 120, 1],
      [2, 1, 120, 3],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(w.busiestDay).toEqual({
      date: '2026-10-05',
      weekday: 1,
      totalCommitments: 3,
      scheduledMinutes: 210,
    });
  });

  it('a weekly series appears exactly once in the week, never as the whole series', async () => {
    const { agent } = await seed();
    const series = (await getWorkload(agent)).days[2]!;
    expect(series.scheduleCount).toBe(1);
    // The series runs 9 Sep - 25 Nov: it shows in each of those weeks once, and nowhere else.
    expect((await getWorkload(agent, '2026-09-07')).totals.scheduleOccurrenceCount).toBe(1);
    expect((await getWorkload(agent, '2026-10-12')).totals.scheduleOccurrenceCount).toBe(1);
    expect((await getWorkload(agent, '2026-11-23')).totals.scheduleOccurrenceCount).toBe(1); // last Wednesday, 25 Nov
    expect((await getWorkload(agent, '2026-11-30')).totals.scheduleOccurrenceCount).toBe(0); // after `until`
    expect((await getWorkload(agent, '2026-08-31')).totals.scheduleOccurrenceCount).toBe(0); // before the first one
  });

  it('is deterministic: the same data answers the same, and equals the week asked by another date', async () => {
    const { agent } = await seed();
    const first = await getWorkload(agent);
    expect(await getWorkload(agent)).toEqual(first);
    expect(await getWorkload(agent, '2026-10-09')).toEqual({
      ...first,
      generatedAt: expect.any(String),
    });
  });

  it('editing a class changes the load right away', async () => {
    const { agent } = await seed();
    const blocks = (await agent.get('/api/schedule?from=2026-10-05&to=2026-10-11')).body
      .occurrences as { blockId: string; title: string }[];
    const redes2 = blocks.find((b) => b.title === 'Redes 2')!;
    await agent.patch(`/api/schedule/${redes2.blockId}`).send({ endTime: '12:30' }).expect(200); // +60 min
    expect((await getWorkload(agent)).totals.scheduledMinutes).toBe(450 + 60);
    await agent.delete(`/api/schedule/${redes2.blockId}`).expect(204);
    const w = await getWorkload(agent);
    expect(w.totals.classCount).toBe(2);
    expect(w.totals.scheduledMinutes).toBe(120 + 120 + 120);
  });
});

describe('what counts as an activity of the week', () => {
  it('a completed activity of the week still counts, with the breakdown by status', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await activityOn(agent, subject.id, '2026-10-08', { status: 'COMPLETED' });
    await activityOn(agent, subject.id, '2026-10-08', { status: 'IN_PROGRESS' });
    await activityOn(agent, subject.id, '2026-10-08', { status: 'PENDING' });
    const w = await getWorkload(agent);
    expect(w.totals.activityCount).toBe(3);
    expect(w.totals.activitiesByStatus).toEqual({ pending: 1, inProgress: 1, completed: 1 });
    expect(w.totals.openActivityCount).toBe(2);
    expect(dayOf(w, 4).activityCount).toBe(3);
  });

  it('an open activity overdue from another week does not count in this one', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await activityOn(agent, subject.id, '2026-09-21'); // two weeks ago, still pending
    await activityOn(agent, subject.id, '2026-10-14'); // next week
    expect((await getWorkload(agent)).totals.activityCount).toBe(0);
    expect((await getWorkload(agent, '2026-10-14')).totals.activityCount).toBe(1);
    expect((await getWorkload(agent, '2026-09-21')).totals.activityCount).toBe(1);
  });

  it('adds commitments but no hours', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await activityOn(agent, subject.id, '2026-10-08');
    await activityOn(agent, subject.id, '2026-10-08');
    const w = await getWorkload(agent);
    expect(w.totals.totalCommitments).toBe(2);
    expect(w.totals.scheduledMinutes).toBe(0);
  });

  it('an activity without time (due the end of the local day) belongs to that day, Sunday included', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await postActivity(agent, subject.id, { title: 'Domingo', dueDate: '2026-10-11' });
    await postActivity(agent, subject.id, { title: 'Lunes siguiente', dueDate: '2026-10-12' });
    const w = await getWorkload(agent);
    expect(w.totals.activityCount).toBe(1);
    expect(dayOf(w, 7).activityCount).toBe(1);
  });

  it('week limits to the millisecond: Monday 00:00 is in; Sunday 23:59:59.999 is in; one ms outside either end is out', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const mondayStart = new Date('2026-10-05T05:00:00.000Z'); // Mon 00:00 Bogotá
    const nextMondayStart = new Date('2026-10-12T05:00:00.000Z');
    const pin = async (title: string, at: Date) => {
      const id = (await postActivity(agent, subject.id, { title })).body.activity.id as string;
      await prisma.activity.update({ where: { id }, data: { dueAt: at } });
    };
    await pin('lunes 00:00', mondayStart);
    await pin('domingo 23:59:59.999', new Date(nextMondayStart.getTime() - 1));
    await pin('domingo anterior 23:59:59.999', new Date(mondayStart.getTime() - 1));
    await pin('lunes siguiente 00:00', nextMondayStart);
    const w = await getWorkload(agent);
    expect(w.totals.activityCount).toBe(2);
    expect(dayOf(w, 1).activityCount).toBe(1);
    expect(dayOf(w, 7).activityCount).toBe(1);
  });
});

describe('what counts as agenda', () => {
  it('counts the occurrences by type with their minutes', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await postBlock(
      agent,
      block({
        type: 'CLASS',
        date: '2026-10-06',
        startTime: '08:00',
        endTime: '10:00',
        subjectId: subject.id,
      }),
    );
    await postBlock(
      agent,
      block({ type: 'STUDY', date: '2026-10-07', startTime: '14:00', endTime: '15:30' }),
    );
    await postBlock(
      agent,
      block({
        type: 'ACADEMIC_PERSONAL',
        title: 'Tutoría',
        date: '2026-10-08',
        startTime: '09:00',
        endTime: '09:45',
      }),
    );
    const t = (await getWorkload(agent)).totals;
    expect(t).toMatchObject({
      classCount: 1,
      studyBlockCount: 1,
      otherAcademicBlockCount: 1,
      scheduleOccurrenceCount: 3,
      totalCommitments: 3,
      scheduledMinutes: 120 + 90 + 45,
    });
  });

  it('a block outside the week does not count', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await postBlock(agent, block({ date: '2026-10-04' })); // the Sunday before
    await postBlock(agent, block({ date: '2026-10-12' })); // the Monday after
    await postBlock(agent, block({ date: '2026-10-06' }));
    expect((await getWorkload(agent)).totals.scheduleOccurrenceCount).toBe(1);
  });

  it('overlapping blocks both count: nothing is merged or subtracted', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await postBlock(
      agent,
      block({
        type: 'CLASS',
        subjectId: subject.id,
        title: 'Una',
        date: '2026-10-06',
        startTime: '08:00',
        endTime: '10:00',
      }),
    );
    await postBlock(
      agent,
      block({
        type: 'STUDY',
        title: 'Otra',
        date: '2026-10-06',
        startTime: '09:00',
        endTime: '11:00',
      }),
    );
    const w = await getWorkload(agent);
    expect(w.totals.scheduleOccurrenceCount).toBe(2);
    expect(w.totals.scheduledMinutes).toBe(240);
    expect(dayOf(w, 2).totalCommitments).toBe(2);
  });

  it('08-10 plus 10-11:30 is 210 minutes', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await postBlock(agent, block({ date: '2026-10-06', startTime: '08:00', endTime: '10:00' }));
    await postBlock(agent, block({ date: '2026-10-06', startTime: '10:00', endTime: '11:30' }));
    expect(dayOf(await getWorkload(agent), 2).scheduledMinutes).toBe(210);
  });
});

describe('the busiest day', () => {
  it('tie on commitments: the day with more scheduled minutes wins', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await postBlock(agent, block({ date: '2026-10-06', startTime: '08:00', endTime: '09:00' })); // Tue: 1 x 60
    await postBlock(agent, block({ date: '2026-10-06', startTime: '10:00', endTime: '11:00' })); // Tue: 2 x 60
    await postBlock(agent, block({ date: '2026-10-08', startTime: '08:00', endTime: '11:00' })); // Thu: 1 x 180
    await postBlock(agent, block({ date: '2026-10-08', startTime: '12:00', endTime: '14:00' })); // Thu: 2 x 120
    expect((await getWorkload(agent)).busiestDay).toMatchObject({
      weekday: 4,
      totalCommitments: 2,
      scheduledMinutes: 300,
    });
  });

  it('total tie: the earliest day of the week', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await postBlock(agent, block({ date: '2026-10-09', startTime: '08:00', endTime: '09:00' })); // Fri
    await postBlock(agent, block({ date: '2026-10-07', startTime: '08:00', endTime: '09:00' })); // Wed
    await postBlock(agent, block({ date: '2026-10-10', startTime: '08:00', endTime: '09:00' })); // Sat
    expect((await getWorkload(agent)).busiestDay).toMatchObject({ weekday: 3 });
  });

  it('activities and agenda add up on the same day; an empty week has none', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    expect((await getWorkload(agent)).busiestDay).toBeNull();
    await activityOn(agent, subject.id, '2026-10-09');
    await activityOn(agent, subject.id, '2026-10-09');
    await postBlock(agent, block({ date: '2026-10-09', startTime: '08:00', endTime: '09:00' }));
    await postBlock(agent, block({ date: '2026-10-06', startTime: '08:00', endTime: '12:00' }));
    expect((await getWorkload(agent)).busiestDay).toMatchObject({
      weekday: 5,
      totalCommitments: 3,
    });
  });
});

describe('scope: the CURRENT period and the user', () => {
  it('ignores activities and blocks of another period', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await activityOn(agent, subject.id, '2026-10-06');
    await postBlock(agent, block({ date: '2026-10-06' }));
    const old = (
      await agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Anterior', startDate: '2026-01-15', endDate: '2026-06-30' })
    ).body.period;
    const oldSubject = (await agent.post('/api/subjects').send({ periodId: old.id, name: 'Vieja' }))
      .body.subject;
    await activityOn(agent, oldSubject.id, '2026-10-06'); // same week, other period
    // The API refuses a block outside its period, so this one is moved to the old period directly.
    const stray = await postBlock(agent, block({ title: 'De otro periodo', date: '2026-10-06' }));
    await prisma.scheduleBlock.update({ where: { id: stray.id }, data: { periodId: old.id } });
    const w = await getWorkload(agent);
    expect(w.totals.activityCount).toBe(1);
    expect(w.totals.scheduleOccurrenceCount).toBe(1);
    // And the old period's own weeks show nothing: only the current period is read.
    expect((await getWorkload(agent, '2026-03-02')).totals.totalCommitments).toBe(0);
  });

  it('never counts another user’s commitments', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await activityOn(a.agent, a.subject.id, '2026-10-06');
    for (let i = 0; i < 3; i++) {
      await activityOn(b.agent, b.subject.id, '2026-10-06');
      await postBlock(
        b.agent,
        block({
          date: '2026-10-06',
          startTime: `${String(8 + i).padStart(2, '0')}:00`,
          endTime: `${String(9 + i).padStart(2, '0')}:00`,
        }),
      );
    }
    const mine = await getWorkload(a.agent);
    expect(mine.totals.totalCommitments).toBe(1);
    const theirs = await getWorkload(b.agent);
    expect(theirs.totals).toMatchObject({
      activityCount: 3,
      scheduleOccurrenceCount: 3,
      scheduledMinutes: 180,
    });
  });
});

describe('timezone: the user’s, never the browser’s or UTC', () => {
  it('a Tokyo user gets Tokyo weeks and Tokyo days', async () => {
    const { agent, user, subject } = await setupUser(app, 'tokyo@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Asia/Tokyo' } });
    // Monday 12 Oct 08:00 in Tokyo is Sunday 11 Oct 23:00 UTC and 18:00 Sunday in Bogotá.
    await activityOn(agent, subject.id, '2026-10-12', { time: '08:00' });
    const thisWeek = await getWorkload(agent, '2026-10-05');
    expect(thisWeek.totals.activityCount).toBe(0);
    const nextWeek = await getWorkload(agent, '2026-10-12');
    expect(nextWeek.totals.activityCount).toBe(1);
    expect(dayOf(nextWeek, 1).activityCount).toBe(1);
  });

  it('the default week follows the profile timezone', async () => {
    const { agent, user } = await setupUser(app, 'tokyo@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Asia/Tokyo' } });
    now = new Date('2026-10-11T16:00:00.000Z'); // Sun 11 Oct 11:00 Bogotá, but already Mon 12 Oct 01:00 in Tokyo
    expect((await getWorkload(agent)).week.from).toBe('2026-10-12');
  });
});

describe('efficiency: a constant number of queries, whatever the amount of data', () => {
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
    const res = await agent.get('/api/workload');
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    return { count: queries.length, ms, workload: workloadResponseSchema.parse(res.body).workload };
  }

  it('uses the same number of queries for an empty week as for 20 subjects / 500 activities / 10 weekly blocks', async () => {
    const { agent, user, period, subject } = await setupUser(loggedApp, 'perf@example.com');
    const small = await measure(agent);

    const ids = [subject.id];
    for (let s = 1; s < 20; s++) {
      ids.push(
        (await agent.post('/api/subjects').send({ periodId: period.id, name: `Asignatura ${s}` }))
          .body.subject.id,
      );
    }
    for (const subjectId of ids) {
      await prisma.activity.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          userId: user.id,
          periodId: period.id,
          subjectId,
          title: `bulk ${i}`,
          type: 'TASK' as const,
          priority: 'MEDIUM' as const,
          // Spread over ~5 weeks around the current one: roughly a fifth lands in it.
          dueAt: new Date(NOW.getTime() + ((i % 35) - 14) * 86_400_000),
          hasTime: true,
        })),
      });
    }
    for (let i = 0; i < 10; i++) {
      await postBlock(
        agent,
        block({
          type: i % 2 ? 'CLASS' : 'STUDY',
          ...(i % 2 ? { subjectId: subject.id } : {}),
          title: `Serie ${i}`,
          date: '2026-09-07',
          startTime: `${String(7 + i).padStart(2, '0')}:00`,
          endTime: `${String(8 + i).padStart(2, '0')}:00`,
          recurrence: { frequency: 'WEEKLY', until: '2026-11-23' },
        }),
      );
    }
    const large = await measure(agent);

    expect(small.workload.totals.totalCommitments).toBe(0);
    expect(large.workload.totals.activityCount).toBeGreaterThan(50);
    expect(large.workload.totals.scheduleOccurrenceCount).toBe(10);
    expect(large.count).toBe(small.count);
    expect(large.count).toBeLessThanOrEqual(6); // session + period + week's activities + agenda candidates (+ lastUsedAt touch)
    console.info(
      `workload: ${large.count} queries, ${large.ms.toFixed(0)} ms for 20 subjects / 500 activities / 10 weekly blocks`,
    );
    expect(large.ms).toBeLessThan(1500);
  });

  it('the number of queries does not depend on the data (empty vs full week)', async () => {
    const { agent, user, subject, period } = await setupUser(loggedApp, 'perf2@example.com');
    const empty = await measure(agent);
    await prisma.activity.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        userId: user.id,
        periodId: period.id,
        subjectId: subject.id,
        title: `x${i}`,
        type: 'TASK' as const,
        priority: 'LOW' as const,
        dueAt: new Date(NOW.getTime() + (i % 5) * 3_600_000),
        hasTime: true,
      })),
    });
    const full = await measure(agent);
    expect(full.workload.totals.activityCount).toBe(200);
    expect(full.count).toBe(empty.count);
  });
});
