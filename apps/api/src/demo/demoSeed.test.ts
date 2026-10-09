import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  attentionResponseSchema,
  progressResponseSchema,
  radarResponseSchema,
  scheduleListResponseSchema,
  toLocalParts,
  workloadResponseSchema,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, ORIGIN, prisma, resetDb, setupUser } from '../../test/helpers.js';
import { ACTIVITIES, DEMO_EMAIL, DEMO_PASSWORD, DEMO_TIMEZONE, buildDemoPlan } from './demoPlan.js';
import {
  ALLOW_FLAG,
  DemoSeedRefused,
  assertDemoSeedAllowed,
  describeTarget,
  deleteDemoUser,
  seedDemo,
} from './seedDemo.js';

/**
 * The demo seed against the TEST database (vitest points DATABASE_URL at it; the demo CLI test passes it on
 * explicitly). The seed is infrastructure: these tests check that it is safe, repeatable and that the dataset it
 * builds is read correctly by the REAL rules (Radar, Attention, Progress, Workload, Reminders), not by copies of them.
 */

// Wednesday 7 October 2026, 10:00 in Bogotá (UTC-5).
const NOW = new Date('2026-10-07T15:00:00.000Z');
let clockNow = NOW;
const app = buildApp({ clock: () => clockNow });

beforeEach(async () => {
  clockNow = NOW;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const login = async () => {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    .expect(200);
  return agent;
};

const demoCounts = async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
  const where = { userId: user.id };
  return {
    users: await prisma.user.count({ where: { email: DEMO_EMAIL } }),
    periods: await prisma.academicPeriod.count({ where }),
    currentPeriods: await prisma.academicPeriod.count({ where: { ...where, isCurrent: true } }),
    subjects: await prisma.subject.count({ where }),
    blocks: await prisma.scheduleBlock.count({ where }),
    activities: await prisma.activity.count({ where }),
    completed: await prisma.activity.count({ where: { ...where, status: 'COMPLETED' } }),
    reminders: await prisma.reminder.count({ where }),
  };
};

describe('the guards', () => {
  it('refuses in production, even with the flag', () => {
    expect(() => assertDemoSeedAllowed({ nodeEnv: 'production', argv: [ALLOW_FLAG] })).toThrowError(
      DemoSeedRefused,
    );
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: ' Production ', argv: [ALLOW_FLAG] }),
    ).toThrowError(/production/);
  });

  it('refuses without the explicit flag, and says how to enable it', () => {
    for (const nodeEnv of [undefined, 'development', 'test']) {
      expect(() => assertDemoSeedAllowed({ nodeEnv, argv: [] })).toThrowError(
        /Demo seed is disabled.*--allow-demo/,
      );
    }
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: 'development', argv: [ALLOW_FLAG] }),
    ).not.toThrow();
  });

  it('describes its target without credentials', () => {
    const text = describeTarget('postgresql://planner:s3cret@example.test:5433/academic_planner');
    expect(text).toBe('example.test:5433/academic_planner');
    expect(text).not.toMatch(/planner:|s3cret|postgresql/);
  });

  const cli = (env: Record<string, string>, args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/demo/cli.ts', ...args], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL!, ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('the real command exits non-zero and writes nothing in production or without the flag', async () => {
    const production = cli({ NODE_ENV: 'production' }, [ALLOW_FLAG]);
    expect(production.status).toBe(2);
    expect(production.stderr).toMatch(/production/);

    const noFlag = cli({ NODE_ENV: 'development' }, []);
    expect(noFlag.status).toBe(2);
    expect(noFlag.stderr).toMatch(/Demo seed is disabled/);

    expect(await prisma.user.count()).toBe(0);
  });

  it('the real command seeds with the flag, prints the target without credentials and exits 0', async () => {
    const run = cli({ NODE_ENV: 'development' }, [ALLOW_FLAG]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/Demo seed created\./);
    expect(run.stdout).toMatch(/database=localhost:5433\/academic_planner_test/);
    expect(run.stdout).toMatch(/Activities: 15/);
    expect(run.stdout + run.stderr).not.toMatch(/planner:planner|passwordHash|\$argon2/);
    expect((await demoCounts()).activities).toBe(15);
  });
});

describe('the dataset', () => {
  it('first run: one user, one current period, 6 subjects, 6 weekly classes, 15 activities', async () => {
    const summary = await seedDemo(prisma, { now: NOW });
    expect(summary).toMatchObject({
      email: DEMO_EMAIL,
      subjects: 6,
      scheduleBlocks: 6,
      activities: 15,
      completed: 4,
    });
    expect(await demoCounts()).toMatchObject({
      users: 1,
      periods: 1,
      currentPeriods: 1,
      subjects: 6,
      blocks: 6,
      activities: 15,
      completed: 4,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    expect(user).toMatchObject({ name: 'Estudiante Demo', timezone: 'America/Bogota' });
  });

  it('everything belongs to the demo user and its current period: no orphans', async () => {
    await seedDemo(prisma, { now: NOW });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    const period = await prisma.academicPeriod.findFirstOrThrow({ where: { userId: user.id } });
    const subjects = await prisma.subject.findMany({ where: { userId: user.id } });
    expect(subjects.every((s) => s.periodId === period.id)).toBe(true);
    const ids = new Set(subjects.map((s) => s.id));
    const activities = await prisma.activity.findMany({ where: { userId: user.id } });
    // The demo has no general activities yet (F1-2): every one has a subject, and the period stored on the
    // activity is the subject's (the database also guarantees it).
    expect(activities.every((a) => a.subjectId !== null && ids.has(a.subjectId))).toBe(true);
    expect(activities.every((a) => a.periodId === period.id)).toBe(true);
    const blocks = await prisma.scheduleBlock.findMany({ where: { userId: user.id } });
    expect(
      blocks.every((b) => b.periodId === period.id && b.subjectId && ids.has(b.subjectId)),
    ).toBe(true);
    const reminders = await prisma.reminder.findMany({ where: { userId: user.id } });
    const activityIds = new Set(activities.map((a) => a.id));
    expect(reminders.every((r) => activityIds.has(r.activityId))).toBe(true);
  });

  it('is deterministic apart from ids: same plan for the same instant', () => {
    expect(buildDemoPlan(NOW)).toEqual(buildDemoPlan(new Date(NOW)));
    const plan = buildDemoPlan(NOW);
    expect(plan.subjects.map((s) => s.name)).toHaveLength(6);
    expect(plan.activities).toHaveLength(15);
    expect(plan.period).toEqual({
      name: 'Semestre demo 2026-II',
      startDate: '2026-08-31',
      endDate: '2026-12-27',
    });
  });

  it('every activity, class and deadline fits the period, completed ones were finished in the past', async () => {
    const plan = buildDemoPlan(NOW);
    for (const a of plan.activities) {
      expect(a.dueDate >= plan.period.startDate && a.dueDate <= plan.period.endDate).toBe(true);
      if (a.status === 'COMPLETED') {
        expect(a.completedAt!.getTime()).toBeLessThan(NOW.getTime());
        expect(a.completedAt!.getTime()).toBeGreaterThan(a.createdAt.getTime());
      }
    }
    for (const c of plan.classes) {
      expect(c.date >= plan.period.startDate && c.until <= plan.period.endDate).toBe(true);
    }
    await seedDemo(prisma, { now: NOW });
    const rows = await prisma.activity.findMany({ where: { status: 'COMPLETED' } });
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.completedAt).not.toBeNull();
      expect(r.completedAt!.getTime()).toBeLessThan(NOW.getTime());
    }
    const open = await prisma.activity.findMany({ where: { status: { not: 'COMPLETED' } } });
    expect(open.every((r) => r.completedAt === null)).toBe(true);
  });

  it('has varied types, priorities and statuses, plausible titles, some descriptions and some professors', async () => {
    const types = new Set(ACTIVITIES.map((a) => a.type));
    for (const t of ['TASK', 'EXAM', 'QUIZ', 'PROJECT', 'PRESENTATION', 'WORKSHOP', 'READING'])
      expect(types).toContain(t);
    expect(new Set(ACTIVITIES.map((a) => a.priority))).toEqual(new Set(['LOW', 'MEDIUM', 'HIGH']));
    expect(new Set(ACTIVITIES.map((a) => a.status))).toEqual(
      new Set(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
    );
    expect(ACTIVITIES.filter((a) => a.status === 'IN_PROGRESS').length).toBeGreaterThanOrEqual(2);
    expect(ACTIVITIES.some((a) => a.description)).toBe(true);
    expect(ACTIVITIES.some((a) => !a.description)).toBe(true);
    expect(ACTIVITIES.every((a) => !/^(actividad|test)\b/i.test(a.title))).toBe(true);
    const plan = buildDemoPlan(NOW);
    expect(plan.subjects.some((s) => s.professor)).toBe(true);
    expect(plan.subjects.some((s) => !s.professor)).toBe(true);
  });
});

describe('idempotency and reset', () => {
  it('a second run does not duplicate anything and keeps the same user id', async () => {
    const first = await seedDemo(prisma, { now: NOW });
    const counts = await demoCounts();
    const second = await seedDemo(prisma, { now: NOW });
    expect(second.userId).toBe(first.userId);
    expect(await demoCounts()).toEqual(counts);
    expect(await prisma.user.count()).toBe(1);
  });

  it('after the demo was changed, running it again restores the initial dataset and ends old sessions', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = await login();
    expect((await agent.get('/api/activities')).body.activities).toHaveLength(15);

    // The presenter edits, deletes and adds things during a demo…
    const list = (await agent.get('/api/activities')).body.activities as {
      id: string;
      title: string;
    }[];
    await agent.delete(`/api/activities/${list[0]!.id}`).expect(204);
    await agent
      .patch(`/api/activities/${list[1]!.id}`)
      .send({ title: 'Cambiado en vivo' })
      .expect(200);
    expect((await agent.get('/api/activities')).body.activities).toHaveLength(14);

    // …and the same command puts it all back.
    await seedDemo(prisma, { now: NOW });
    expect((await agent.get('/api/auth/me')).status).toBe(401); // the old browser session is gone
    const fresh = await login();
    const titles = ((await fresh.get('/api/activities')).body.activities as { title: string }[])
      .map((a) => a.title)
      .sort();
    expect(titles).toEqual(ACTIVITIES.map((a) => a.title).sort());
  });

  it('never touches another user: their data and their session survive any number of runs', async () => {
    const x = await setupUser(app, 'x@example.com', 'Física');
    await x.agent
      .post('/api/activities')
      .send({ subjectId: x.subject.id, title: 'Laboratorio', dueDate: '2026-10-20' })
      .expect(201);
    const mine = async () => ({
      periods: await prisma.academicPeriod.count({ where: { userId: x.user.id } }),
      subjects: await prisma.subject.count({ where: { userId: x.user.id } }),
      activities: await prisma.activity.count({ where: { userId: x.user.id } }),
      reminders: await prisma.reminder.count({ where: { userId: x.user.id } }),
      sessions: await prisma.session.count({ where: { userId: x.user.id } }),
    });
    const before = await mine();
    expect(before.activities).toBe(1);

    await seedDemo(prisma, { now: NOW });
    await seedDemo(prisma, { now: NOW });

    expect(await mine()).toEqual(before);
    expect((await x.agent.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.user.count()).toBe(2);
  });

  it('a failure half-way leaves other users untouched, and the next run repairs the demo', async () => {
    const x = await setupUser(app, 'y@example.com', 'Química');
    const broken = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === 'scheduleBlock') {
          return new Proxy(target.scheduleBlock, {
            get(t, p, r) {
              if (p === 'create') return () => Promise.reject(new Error('simulated failure'));
              return Reflect.get(t, p, r);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(seedDemo(broken, { now: NOW })).rejects.toThrow(/simulated failure/);
    expect(await prisma.subject.count({ where: { userId: x.user.id } })).toBe(1);
    expect((await x.agent.get('/api/auth/me')).status).toBe(200);

    await seedDemo(prisma, { now: NOW });
    expect(await demoCounts()).toMatchObject({ subjects: 6, blocks: 6, activities: 15 });
  });

  it('deleteDemoUser removes the demo and only the demo', async () => {
    const x = await setupUser(app, 'z@example.com');
    await seedDemo(prisma, { now: NOW });
    await deleteDemoUser(prisma);
    expect(await prisma.user.count({ where: { email: DEMO_EMAIL } })).toBe(0);
    expect(await prisma.activity.count({ where: { userId: x.user.id } })).toBe(0);
    expect((await x.agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('what the real rules say about the demo', () => {
  it('the demo user signs in through the normal endpoint, in Bogotá time', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
      .expect(200);
    expect(res.body.user).toMatchObject({ email: DEMO_EMAIL, timezone: 'America/Bogota' });
    expect(res.body.user.passwordHash).toBeUndefined();
    await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: DEMO_EMAIL, password: 'wrong password!' })
      .expect(401);
  });

  it('Radar: every band is represented, completed activities are in none', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = await login();
    const radar = radarResponseSchema.parse((await agent.get('/api/radar')).body).radar;
    expect(radar.summary).toMatchObject({
      overdue: 1,
      immediate: 2,
      upcoming: 2,
      plannable: 3,
      underControl: 3,
    });
  });

  it('Attention: "Parcial 1 de Redes" leads, with the rules’ own reasons, and the overdue one does not dominate', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = await login();
    const attention = attentionResponseSchema.parse(
      (await agent.get('/api/attention')).body,
    ).attention;
    expect(attention.recommendation?.activity.title).toBe('Parcial 1 de Redes');
    expect(attention.recommendation?.activity.priority).toBe('HIGH');
    expect(attention.recommendation?.radarStatus).toBe('IMMEDIATE');
    expect(attention.recommendation?.reasons.length).toBeGreaterThan(0);
  });

  it('Progress: 4 of 15 (27 %), with subjects in different states', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = await login();
    const { general, subjects } = progressResponseSchema.parse(
      (await agent.get('/api/progress')).body,
    ).progress;
    expect(general).toMatchObject({ completed: 4, total: 15, percentage: 27 });
    expect(general.percentage).toBeGreaterThan(20);
    expect(general.percentage).toBeLessThan(60);
    const by = Object.fromEntries(subjects.map((s) => [s.name, s]));
    expect(by['Redes de Computadores']).toMatchObject({ completed: 2, total: 4 });
    expect(by['Epidemiología']).toMatchObject({ completed: 0, total: 2 });
    expect(by['Seguridad Informática']).toMatchObject({ completed: 0, total: 1 });
  });

  it('Workload: the week has commitments and a busiest day; Agenda has the week’s classes', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = await login();
    const w = workloadResponseSchema.parse((await agent.get('/api/workload')).body).workload;
    expect(w.totals.totalCommitments).toBeGreaterThan(0);
    expect(w.totals.scheduleOccurrenceCount).toBe(6);
    expect(w.busiestDay).not.toBeNull();
    const agenda = scheduleListResponseSchema.parse((await agent.get('/api/schedule')).body);
    expect(agenda.occurrences).toHaveLength(6);
  });

  it('Dashboard answers with real data', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = await login();
    const dash = (await agent.get('/api/dashboard')).body.dashboard;
    expect(dash).toMatchObject({ subjectCount: 6, period: { name: 'Semestre demo 2026-II' } });
    expect(dash.progress).toEqual({ completed: 4, total: 15, percent: 27 });
    expect(dash.nextDue.title).toBe('Parcial 1 de Redes');
  });

  it('Reminders come from the real rules: finished activities have none pending, one is MANUAL, some are due', async () => {
    await seedDemo(prisma, { now: NOW });
    const agent = await login();
    const all = (await agent.get('/api/reminders')).body.reminders as {
      kind: string;
      status: string;
      activityId: string;
    }[];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((r) => r.kind === 'MANUAL')).toHaveLength(1);

    const done = new Set(
      (await prisma.activity.findMany({ where: { status: 'COMPLETED' } })).map((a) => a.id),
    );
    const ofDone = all.filter((r) => done.has(r.activityId));
    expect(ofDone.every((r) => r.status === 'CANCELLED')).toBe(true);
    const pendingInPast = await prisma.reminder.count({
      where: { status: 'PENDING', remindAt: { lte: NOW }, activityId: { in: [...done] } },
    });
    expect(pendingInPast).toBe(0);

    const due = (await agent.get('/api/reminders/due')).body as { total: number };
    expect(due.total).toBeGreaterThanOrEqual(1);

    // The overdue activity's reminders were already seen: the panel lists only live deadlines, once each.
    const waiting = await prisma.reminder.findMany({
      where: { status: 'PENDING', remindAt: { lte: NOW } },
      include: { activity: true },
    });
    expect(waiting.map((r) => r.activity.title).sort()).toEqual([
      'Parcial 1 de Redes',
      'Tarea de formularios y validación',
    ]);
    const overdue = await prisma.activity.findFirstOrThrow({
      where: { title: 'Informe de práctica estadística' },
    });
    const ofOverdue = await prisma.reminder.findMany({ where: { activityId: overdue.id } });
    expect(ofOverdue.length).toBeGreaterThan(0);
    expect(ofOverdue.every((r) => r.status === 'SHOWN')).toBe(true);
  });

  it('nobody else can see or open the demo, not even with its ids', async () => {
    await seedDemo(prisma, { now: NOW });
    const x = await setupUser(app, 'intruder@example.com');
    const target = await prisma.activity.findFirstOrThrow({
      where: { title: 'Parcial 1 de Redes' },
    });
    expect((await x.agent.get(`/api/activities/${target.id}`)).status).toBe(404);
    expect((await x.agent.get('/api/activities')).body.activities).toHaveLength(0);
    expect((await x.agent.get('/api/radar')).body.radar.summary).toMatchObject({ immediate: 0 });
  });
});

describe('any day of the calendar', () => {
  // Monday just after midnight, Sunday just before it, month end, year end, and a leap day.
  const days = [
    '2026-10-05T05:01:00.000Z', // Mon 00:01 Bogotá
    '2026-10-12T04:59:00.000Z', // Sun 23:59 Bogotá
    '2026-10-31T17:00:00.000Z',
    '2026-12-31T23:30:00.000Z',
    '2028-02-29T15:00:00.000Z',
  ];
  for (const iso of days) {
    it(`gives the same story on ${iso}`, async () => {
      const at = new Date(iso);
      clockNow = at;
      await seedDemo(prisma, { now: at });
      const agent = await login();
      const radar = radarResponseSchema.parse((await agent.get('/api/radar')).body).radar;
      expect(radar.summary).toMatchObject({
        overdue: 1,
        immediate: 2,
        upcoming: 2,
        plannable: 3,
        underControl: 3,
      });
      const attention = attentionResponseSchema.parse(
        (await agent.get('/api/attention')).body,
      ).attention;
      expect(attention.recommendation?.activity.title).toBe('Parcial 1 de Redes');
      const plan = buildDemoPlan(at);
      const today = toLocalParts(at, DEMO_TIMEZONE).date;
      expect(plan.period.startDate <= today && today <= plan.period.endDate).toBe(true);
      expect((await demoCounts()).activities).toBe(15);
    });
  }
});
