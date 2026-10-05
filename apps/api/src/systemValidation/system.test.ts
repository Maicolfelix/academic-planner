import {
  attentionResponseSchema,
  progressResponseSchema,
  radarResponseSchema,
  scheduleListResponseSchema,
  workloadResponseSchema,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApp,
  credentials,
  postActivity,
  prisma,
  resetDb,
  sessionCookie,
  setupUser,
} from '../../test/helpers.js';

/**
 * System validation through the API, with a controlled clock: the modules are exercised TOGETHER (Activities,
 * Reminders, Radar, Attention, Progress, Workload, Dashboard, Agenda) and checked against each other and against
 * independent sources, not against their own output. The browser-level story is e2e/system-validation.spec.ts.
 */

// Monday 5 October 2026, 12:00 in Bogotá (UTC-5).
const NOON = new Date('2026-10-05T17:00:00.000Z');
let now = NOON;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = NOON;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;

interface Story {
  agent: Agent;
  user: { id: string; email: string };
  subjects: { redes: string; bases: string; vacia: string };
  ids: {
    overdue: string;
    immediate: string;
    upcoming: string;
    plannable: string;
    underControl: string;
    completed: string;
  };
}

/** One student, one period, three subjects (one of them empty), two weekly classes and six activities. */
async function story(email = 'ana@example.com'): Promise<Story> {
  const { agent, user, subject, period } = await setupUser(app, email, 'Redes');
  const bases = (
    await agent.post('/api/subjects').send({ periodId: period.id, name: 'Bases de Datos' })
  ).body.subject.id as string;
  const vacia = (
    await agent.post('/api/subjects').send({ periodId: period.id, name: 'Farmacología' })
  ).body.subject.id as string;
  const mk = async (subjectId: string, title: string, body: object) =>
    (await postActivity(agent, subjectId, { title, ...body })).body.activity.id as string;
  const ids = {
    overdue: await mk(subject.id, 'Lectura atrasada', { dueDate: '2026-10-04', priority: 'HIGH' }),
    immediate: await mk(subject.id, 'Taller express', {
      type: 'WORKSHOP',
      dueDate: '2026-10-05',
      dueTime: '23:00',
    }),
    upcoming: await mk(bases, 'Parcial de Bases', {
      type: 'EXAM',
      dueDate: '2026-10-07',
      dueTime: '10:00',
    }),
    plannable: await mk(bases, 'Proyecto integrador', {
      type: 'PROJECT',
      dueDate: '2026-10-10',
      dueTime: '10:00',
    }),
    underControl: await mk(subject.id, 'Tarea de subredes', {
      dueDate: '2026-10-15',
      dueTime: '10:00',
    }),
    completed: await mk(bases, 'Quiz ya hecho', {
      type: 'QUIZ',
      dueDate: '2026-10-09',
      dueTime: '08:00',
    }),
  };
  await agent.patch(`/api/activities/${ids.completed}`).send({ status: 'COMPLETED' }).expect(200);
  for (const [sid, title, date, start, end] of [
    [subject.id, 'Redes', '2026-08-03', '08:00', '10:00'], // Mondays
    [bases, 'Bases de Datos', '2026-08-06', '14:00', '16:00'], // Thursdays
  ] as const) {
    await agent
      .post('/api/schedule')
      .send({
        type: 'CLASS',
        subjectId: sid,
        title,
        date,
        startTime: start,
        endTime: end,
        recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
      })
      .expect(201);
  }
  return { agent, user, subjects: { redes: subject.id, bases, vacia }, ids };
}

const radar = async (a: Agent) => radarResponseSchema.parse((await a.get('/api/radar')).body).radar;
const attention = async (a: Agent) =>
  attentionResponseSchema.parse((await a.get('/api/attention')).body).attention;
const progress = async (a: Agent) =>
  progressResponseSchema.parse((await a.get('/api/progress')).body).progress;
const workload = async (a: Agent) =>
  workloadResponseSchema.parse((await a.get('/api/workload')).body).workload;
const dashboard = async (a: Agent) => (await a.get('/api/dashboard')).body.dashboard;
const titles = (l: { title: string }[]) => l.map((x) => x.title);

describe('the modules agree with each other (fixed clock)', () => {
  it('Radar puts every activity in exactly its band, and completed ones nowhere', async () => {
    const s = await story();
    const r = await radar(s.agent);
    expect(r.summary).toEqual({
      overdue: 1,
      immediate: 1,
      upcoming: 1,
      plannable: 1,
      underControl: 1,
    });
    expect(titles(r.groups.overdue)).toEqual(['Lectura atrasada']);
    expect(titles(r.groups.immediate)).toEqual(['Taller express']);
    expect(titles(r.groups.upcoming)).toEqual(['Parcial de Bases']);
    expect(titles(r.groups.plannable)).toEqual(['Proyecto integrador']);
    expect(titles(r.groups.underControl)).toEqual(['Tarea de subredes']);
    expect(JSON.stringify(r)).not.toContain('Quiz ya hecho');
  });

  it('Radar boundaries as a smoke: 23 h 59 min is immediate, 24 h 1 min is upcoming, an hour ago is overdue, 8 days is under control', async () => {
    const s = await story();
    const make = async (title: string, date: string, time: string) =>
      (await postActivity(s.agent, s.subjects.redes, { title, dueDate: date, dueTime: time })).body
        .activity.id as string;
    await make('casi un día', '2026-10-06', '11:59');
    await make('un día y un minuto', '2026-10-06', '12:01');
    await make('hace una hora', '2026-10-05', '11:00');
    await make('en ocho días', '2026-10-13', '12:00');
    const g = (await radar(s.agent)).groups;
    expect(titles(g.immediate)).toContain('casi un día');
    expect(titles(g.upcoming)).toContain('un día y un minuto');
    expect(titles(g.overdue)).toContain('hace una hora');
    expect(titles(g.underControl)).toContain('en ocho días');
  });

  it('the recommendation follows the rules, and completing / reopening it moves every module the same way', async () => {
    const s = await story();
    // 1. Before: the overdue, high-priority activity leads; the Dashboard says the same.
    expect((await attention(s.agent)).recommendation?.activity.title).toBe('Lectura atrasada');
    expect((await attention(s.agent)).recommendation?.radarStatus).toBe('OVERDUE');
    const before = {
      progress: await progress(s.agent),
      dash: await dashboard(s.agent),
      wl: await workload(s.agent),
    };
    expect(before.progress.general).toMatchObject({
      total: 6,
      completed: 1,
      pending: 5,
      overdue: 1,
      percentage: 17,
    });
    expect(before.dash.progress).toEqual({ completed: 1, total: 6, percent: 17 });
    expect(before.dash.summary).toEqual({
      total: 6,
      pending: 5,
      inProgress: 0,
      completed: 1,
      overdue: 1,
    });

    // 2. Complete the recommended one.
    await s.agent
      .patch(`/api/activities/${s.ids.overdue}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect((await radar(s.agent)).summary.overdue).toBe(0);
    expect(JSON.stringify(await radar(s.agent))).not.toContain('Lectura atrasada');
    expect((await attention(s.agent)).recommendation?.activity.title).toBe('Taller express');
    const done = await progress(s.agent);
    expect(done.general).toMatchObject({
      total: 6,
      completed: 2,
      pending: 4,
      overdue: 0,
      percentage: 33,
    });
    const redes = done.subjects.find((x) => x.name === 'Redes')!;
    expect(redes).toMatchObject({ total: 3, completed: 1, overdue: 0, percentage: 33 });
    expect((await dashboard(s.agent)).summary).toMatchObject({ completed: 2, overdue: 0 });
    expect((await dashboard(s.agent)).progress.percent).toBe(33);
    // It sits outside the current week, so the week's workload is untouched.
    expect((await workload(s.agent)).totals).toEqual(before.wl.totals);

    // 3. Reopen it: everything comes back.
    await s.agent.patch(`/api/activities/${s.ids.overdue}`).send({ status: 'PENDING' }).expect(200);
    expect((await radar(s.agent)).summary).toEqual({
      overdue: 1,
      immediate: 1,
      upcoming: 1,
      plannable: 1,
      underControl: 1,
    });
    expect((await attention(s.agent)).recommendation?.activity.title).toBe('Lectura atrasada');
    expect((await progress(s.agent)).general).toMatchObject({ completed: 1, percentage: 17 });
    expect((await dashboard(s.agent)).progress.percent).toBe(17);
    const row = await prisma.activity.findUniqueOrThrow({ where: { id: s.ids.overdue } });
    expect(row.completedAt).toBeNull();
  });

  it('a subject with no activities is reported as empty, not as 0 % progress', async () => {
    const s = await story();
    const empty = (await progress(s.agent)).subjects.find((x) => x.name === 'Farmacología')!;
    expect(empty).toMatchObject({ total: 0, completed: 0, pending: 0 });
  });

  it('Workload equals what the Agenda and the Activities list say independently, and never judges', async () => {
    const s = await story();
    const w = await workload(s.agent);
    expect(w.week).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    const agenda = scheduleListResponseSchema.parse(
      (await s.agent.get('/api/schedule?from=2026-10-05&to=2026-10-11')).body,
    ).occurrences;
    const activities = (await s.agent.get('/api/activities')).body.activities as {
      dueAt: string;
      status: string;
    }[];
    const localDay = (iso: string) =>
      new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const inWeek = activities.filter(
      (a) => localDay(a.dueAt) >= '2026-10-05' && localDay(a.dueAt) <= '2026-10-11',
    );
    expect(w.totals.scheduleOccurrenceCount).toBe(agenda.length);
    expect(w.totals.activityCount).toBe(inWeek.length);
    expect(w.totals.openActivityCount).toBe(inWeek.filter((a) => a.status !== 'COMPLETED').length);
    expect(w.totals.totalCommitments).toBe(
      w.totals.activityCount + w.totals.scheduleOccurrenceCount,
    );
    expect(w.totals.scheduledMinutes).toBe(
      agenda.reduce(
        (m, o) => m + (new Date(o.endAt).getTime() - new Date(o.startAt).getTime()) / 60_000,
        0,
      ),
    );
    // Mon: express workshop + Redes class; nothing else reaches 2.
    expect(w.busiestDay).toMatchObject({ date: '2026-10-05', totalCommitments: 2 });
    expect(JSON.stringify(w)).not.toMatch(/estr[eé]s|sobrecarg|alto|demasiad/i);
    // Dashboard shows the same week.
    expect((await dashboard(s.agent)).classesToday.map((c: { title: string }) => c.title)).toEqual([
      'Redes',
    ]);
  });

  it('Dashboard, Activities and Radar describe the same activities', async () => {
    const s = await story();
    const d = await dashboard(s.agent);
    const all = (await s.agent.get('/api/activities')).body.activities as {
      title: string;
      status: string;
    }[];
    expect(d.summary.total).toBe(all.length);
    expect(d.summary.completed).toBe(all.filter((a) => a.status === 'COMPLETED').length);
    expect(titles(d.overdue)).toEqual(['Lectura atrasada']);
    expect(titles(d.today)).toEqual(['Taller express']);
    expect(d.nextDue.title).toBe('Taller express');
  });
});

describe('reminders follow the activity', () => {
  it('an exam gets only FUTURE automatic reminders, before its deadline; completing cancels them and reopening revives them', async () => {
    const s = await story();
    const list = async () =>
      (await s.agent.get(`/api/reminders?activityId=${s.ids.upcoming}`)).body.reminders as {
        remindAt: string;
        status: string;
        kind: string;
      }[];
    const due = new Date('2026-10-07T15:00:00.000Z');
    const open = await list();
    expect(open.length).toBeGreaterThan(0);
    for (const r of open) {
      expect(r.kind).toBe('AUTO');
      expect(r.status).toBe('PENDING');
      expect(new Date(r.remindAt).getTime()).toBeGreaterThan(NOON.getTime()); // only future ones
      expect(new Date(r.remindAt).getTime()).toBeLessThan(due.getTime());
    }
    await s.agent
      .patch(`/api/activities/${s.ids.upcoming}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect((await list()).filter((r) => r.status === 'PENDING')).toEqual([]);
    await s.agent
      .patch(`/api/activities/${s.ids.upcoming}`)
      .send({ status: 'PENDING' })
      .expect(200);
    expect((await list()).filter((r) => r.status === 'PENDING')).toHaveLength(open.length);
  });

  it('a shown reminder stays shown (it survives a new request, a new session and a new server)', async () => {
    const s = await story();
    await prisma.reminder.updateMany({
      where: { userId: s.user.id, activity: { title: 'Parcial de Bases' } },
      data: { remindAt: new Date('2026-10-05T16:59:00Z') },
    });
    const dueNow = (a: Agent) => a.get('/api/reminders/due');
    const first = (await dueNow(s.agent)).body;
    expect(first.total).toBeGreaterThan(0);
    const ids = first.reminders.map((r: { id: string }) => r.id);
    await s.agent.post('/api/reminders/seen').send({ ids }).expect(200);
    expect((await dueNow(s.agent)).body.total).toBe(0);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: credentialsOf(s), password: credentials.password });
    const fresh = request.agent(app);
    fresh.set('Cookie', sessionCookie(login)!);
    expect((await dueNow(fresh)).body.total).toBe(0);
    const restarted = request.agent(buildApp({ clock: () => now }));
    restarted.set('Cookie', sessionCookie(login)!);
    expect((await dueNow(restarted)).body.total).toBe(0);
  });
});

const credentialsOf = (s: Story) => s.user.email;

describe('persistence does not depend on the memory of the process', () => {
  it('a brand-new server instance (a restart) serves the same session and the same data', async () => {
    const s = await story();
    const reg = await request(app)
      .post('/api/auth/login')
      .send({ email: s.user.email, password: 'correct horse battery' });
    const cookie = sessionCookie(reg)!;
    const before = {
      activities: (await s.agent.get('/api/activities')).body,
      subjects: (await s.agent.get('/api/subjects')).body,
      week: (await s.agent.get('/api/schedule?from=2026-10-05&to=2026-10-11')).body,
      dash: await dashboard(s.agent),
    };
    const restarted = request.agent(buildApp({ clock: () => now }));
    restarted.set('Cookie', cookie);
    expect((await restarted.get('/api/auth/me')).body.user.email).toBe(s.user.email);
    expect((await restarted.get('/api/activities')).body).toEqual(before.activities);
    expect((await restarted.get('/api/subjects')).body).toEqual(before.subjects);
    expect((await restarted.get('/api/schedule?from=2026-10-05&to=2026-10-11')).body).toEqual(
      before.week,
    );
    expect(await dashboard(restarted)).toEqual(before.dash);
  });
});

describe('the data is internally consistent after a full story', () => {
  it('ownership, periods, completion and reminders all line up in the database', async () => {
    const a = await story('a@example.com');
    const b = await story('b@example.com');
    // Some churn: complete, reopen, edit a date, delete an activity.
    await a.agent
      .patch(`/api/activities/${a.ids.upcoming}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    await a.agent
      .patch(`/api/activities/${a.ids.upcoming}`)
      .send({ status: 'PENDING' })
      .expect(200);
    await a.agent
      .patch(`/api/activities/${a.ids.plannable}`)
      .send({ dueDate: '2026-10-12', dueTime: '09:00' })
      .expect(200);
    await b.agent.delete(`/api/activities/${b.ids.underControl}`).expect(204);

    for (const owner of [a, b]) {
      const uid = owner.user.id;
      const activities = await prisma.activity.findMany({
        where: { userId: uid },
        include: { subject: true },
      });
      expect(activities.length).toBeGreaterThan(0);
      for (const act of activities) {
        expect(act.subject.userId).toBe(uid); // an activity only uses its owner's subject
        expect((act.status === 'COMPLETED') === (act.completedAt !== null)).toBe(true); // completion is coherent
      }
      const blocks = await prisma.scheduleBlock.findMany({
        where: { userId: uid },
        include: { period: true, subject: true },
      });
      for (const bl of blocks) {
        expect(bl.period.userId).toBe(uid);
        expect(bl.subject?.userId).toBe(uid);
        expect(bl.subject?.periodId).toBe(bl.periodId); // a class uses a subject of ITS period
        expect(bl.endAt.getTime()).toBeGreaterThan(bl.startAt.getTime());
        expect(bl.recurrenceUntil!.getTime()).toBeLessThanOrEqual(bl.period.endDate.getTime());
      }
      const reminders = await prisma.reminder.findMany({
        where: { userId: uid },
        include: { activity: true },
      });
      for (const r of reminders) {
        expect(r.activity.userId).toBe(uid); // no reminder points at someone else's activity
        if (r.kind === 'AUTO')
          expect(r.remindAt.getTime()).toBeLessThan(r.activity.dueAt.getTime());
        if (r.activity.status === 'COMPLETED') expect(r.status).not.toBe('PENDING'); // none left to fire
      }
      const periods = await prisma.academicPeriod.findMany({ where: { userId: uid } });
      expect(periods.filter((p) => p.isCurrent)).toHaveLength(1);
    }
    // Nothing is shared between the two students.
    const bIds = new Set(
      (await prisma.activity.findMany({ where: { userId: b.user.id }, select: { id: true } })).map(
        (x) => x.id,
      ),
    );
    for (const x of await prisma.activity.findMany({
      where: { userId: a.user.id },
      select: { id: true },
    }))
      expect(bIds.has(x.id)).toBe(false);
    expect(await prisma.reminder.count({ where: { activityId: b.ids.underControl } })).toBe(0); // deleted with its activity
  });
});

describe('time boundaries', () => {
  it('across midnight in Bogotá the day, "today", overdue and Radar all flip together', async () => {
    const { agent, subject } = await setupUser(app, 'night@example.com', 'Redes');
    const late = (
      await postActivity(agent, subject.id, {
        title: 'Entrega de las 11:59',
        dueDate: '2026-10-05',
        dueTime: '23:59',
      })
    ).body.activity.id as string;
    await postActivity(agent, subject.id, {
      title: 'Para mañana',
      dueDate: '2026-10-06',
      dueTime: '10:00',
    });

    now = new Date('2026-10-06T04:50:00.000Z'); // 23:50 on the 5th in Bogotá (it is already the 6th in UTC and in Tokyo)
    let d = await dashboard(agent);
    expect(d.localDate).toBe('2026-10-05');
    expect(titles(d.today)).toEqual(['Entrega de las 11:59']);
    expect(d.summary.overdue).toBe(0);
    expect(titles((await radar(agent)).groups.immediate)).toContain('Entrega de las 11:59');

    now = new Date('2026-10-06T05:10:00.000Z'); // 00:10 on the 6th
    d = await dashboard(agent);
    expect(d.localDate).toBe('2026-10-06');
    expect(titles(d.overdue)).toEqual(['Entrega de las 11:59']);
    expect(titles(d.today)).toEqual(['Para mañana']);
    expect(titles((await radar(agent)).groups.overdue)).toEqual(['Entrega de las 11:59']);
    expect(d.greeting).toBe('Buenas noches'); // 00:10 is still night
    void late;
  });

  it('the period edges: a class can not start before the period or repeat past its end, and its last week stops there', async () => {
    const { agent, subject } = await setupUser(app, 'edge@example.com', 'Redes');
    const block = (over: object) => ({
      type: 'CLASS',
      subjectId: subject.id,
      title: 'Redes',
      date: '2026-08-08',
      startTime: '08:00',
      endTime: '10:00',
      recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
      ...over,
    });
    expect((await agent.post('/api/schedule').send(block({ date: '2026-08-02' }))).status).toBe(
      400,
    ); // before the period
    expect(
      (
        await agent
          .post('/api/schedule')
          .send(block({ recurrence: { frequency: 'WEEKLY', until: '2026-12-05' } }))
      ).status,
    ).toBe(400); // past its end
    expect(
      (await agent.post('/api/schedule').send(block({ date: '2026-12-01', recurrence: null })))
        .status,
    ).toBe(400); // after the end
    expect((await agent.post('/api/schedule').send(block({}))).status).toBe(201); // Saturdays; 28 Nov is the last one
    const day = async (from: string, to: string) =>
      scheduleListResponseSchema.parse(
        (await agent.get(`/api/schedule?from=${from}&to=${to}`)).body,
      ).occurrences;
    expect((await day('2026-11-23', '2026-11-29')).map((o) => o.occurrenceDate)).toEqual([
      '2026-11-28',
    ]);
    expect(await day('2026-11-30', '2026-12-06')).toEqual([]);
    expect((await day('2026-08-03', '2026-08-09')).map((o) => o.occurrenceDate)).toEqual([
      '2026-08-08',
    ]);
  });
});

describe('error answers are consistent', () => {
  it('every failure has the same envelope and the right status', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 1, registerMax: 100 } });
    const { agent, period } = await setupUser(limited, 'e@example.com', 'Redes');
    const expectFailure = async (
      label: string,
      send: () => Promise<request.Response>,
      status: number,
      code: string,
    ) => {
      const res = await send();
      expect(res.status, label).toBe(status);
      expect(Object.keys(res.body), label).toEqual(['error']);
      expect(res.body.error.code, label).toBe(code);
      expect(typeof res.body.error.message, label).toBe('string');
    };
    await expectFailure(
      'validation',
      () =>
        agent
          .post('/api/activities')
          .send({})
          .then((r) => r),
      400,
      'VALIDATION_ERROR',
    );
    await expectFailure(
      'unauthenticated',
      () =>
        request(limited)
          .get('/api/activities')
          .then((r) => r),
      401,
      'UNAUTHENTICATED',
    );
    await expectFailure(
      'absent',
      () => agent.get('/api/activities/00000000-0000-4000-8000-000000000000').then((r) => r),
      404,
      'NOT_FOUND',
    );
    await expectFailure(
      'conflict',
      () =>
        agent
          .post('/api/subjects')
          .send({ periodId: period.id, name: 'redes' })
          .then((r) => r),
      409,
      'SUBJECT_ALREADY_EXISTS',
    );
    await expectFailure(
      'too large',
      () =>
        agent
          .post('/api/activities')
          .set('Content-Type', 'application/json')
          .send(`{"title":"${'x'.repeat(200_000)}"}`)
          .then((r) => r),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    await expectFailure(
      'unsupported type',
      () =>
        agent
          .post('/api/activities')
          .set('Content-Type', 'text/plain')
          .send('x')
          .then((r) => r),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
    await expectFailure(
      'forged origin',
      () =>
        agent
          .post('/api/activities')
          .set('Origin', 'https://evil.example')
          .send({})
          .then((r) => r),
      403,
      'INVALID_ORIGIN',
    );
    const bad = { email: 'nadie@example.com', password: 'wrong password' };
    await request(limited).post('/api/auth/login').send(bad);
    await expectFailure(
      'rate limit',
      () =>
        request(limited)
          .post('/api/auth/login')
          .send(bad)
          .then((r) => r),
      429,
      'RATE_LIMITED',
    );
  });
});
