import { PrismaPg } from '@prisma/adapter-pg';
import { dashboardResponseSchema, progressResponseSchema, type Progress } from '@planner/core';
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

// "Now" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5).
const NOW = new Date('2026-10-05T17:00:00.000Z');
let now = NOW;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = NOW;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;

const getProgress = async (agent: request.Agent): Promise<Progress> => {
  const res = await agent.get('/api/progress');
  expect(res.status).toBe(200);
  return progressResponseSchema.parse(res.body).progress; // also validates the whole shape
};

type Status = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

/** Creates activities in a subject; `dueInDays` is relative to NOW (negative = overdue). */
async function add(
  agent: request.Agent,
  subjectId: string,
  n: number,
  status: Status,
  dueInDays = 20,
  title = 'Act',
) {
  for (let i = 0; i < n; i++) {
    const id = (await postActivity(agent, subjectId, { title: `${title} ${status} ${i}` })).body
      .activity.id as string;
    await prisma.activity.update({
      where: { id },
      data: {
        status,
        completedAt: status === 'COMPLETED' ? NOW : null,
        dueAt: new Date(NOW.getTime() + dueInDays * DAY),
      },
    });
  }
}

const subjectOf = async (agent: request.Agent, periodId: string, name: string) =>
  (await agent.post('/api/subjects').send({ periodId, name })).body.subject as { id: string };

describe('GET /api/progress — access', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/api/progress');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is never cached', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect((await agent.get('/api/progress')).headers['cache-control']).toBe('no-store');
  });

  it('a user without a period gets an empty answer, not an error', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const p = await getProgress(agent);
    expect(p.period).toBeNull();
    expect(p.subjects).toEqual([]);
    expect(p.general).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      overdue: 0,
      percentage: 0,
    });
  });

  it('ignores a userId or periodId in the query string: scope always comes from the session', async () => {
    const a = await setupUser(app, 'a@example.com', 'Materia A');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await add(a.agent, a.subject.id, 1, 'PENDING');
    await add(b.agent, b.subject.id, 5, 'COMPLETED');
    const res = await a.agent.get(`/api/progress?userId=${b.user.id}&periodId=${b.period.id}`);
    const p = progressResponseSchema.parse(res.body).progress;
    expect(p.period?.id).toBe(a.period.id);
    expect(p.general.total).toBe(1);
    expect(p.subjects.map((s) => s.name)).toEqual(['Materia A']);
  });
});

describe('general progress', () => {
  it('no activities: 0 %, with the subject listed and total 0', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const p = await getProgress(agent);
    expect(p.general).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      overdue: 0,
      percentage: 0,
    });
    expect(p.subjects).toHaveLength(1);
    expect(p.subjects[0]).toMatchObject({ id: subject.id, name: 'Redes', total: 0, percentage: 0 });
  });

  it('5 activities (2 completed, 2 pending, 1 in progress) is 40 %', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await add(agent, subject.id, 2, 'COMPLETED');
    await add(agent, subject.id, 2, 'PENDING');
    await add(agent, subject.id, 1, 'IN_PROGRESS');
    const { general } = await getProgress(agent);
    expect(general).toEqual({
      total: 5,
      completed: 2,
      pending: 2,
      inProgress: 1,
      overdue: 0,
      percentage: 40,
    });
  });

  it('is exactly the Dashboard’s progress (one rule, two views)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await add(agent, subject.id, 3, 'COMPLETED');
    await add(agent, subject.id, 7, 'PENDING');
    const p = await getProgress(agent);
    const d = dashboardResponseSchema.parse((await agent.get('/api/dashboard')).body).dashboard;
    expect(p.general.percentage).toBe(d.progress.percent);
    expect(p.general.total).toBe(d.progress.total);
    expect(p.general.completed).toBe(d.progress.completed);
  });

  it('100 % when everything is finished, and 0 % with activities none of which is finished', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await add(agent, subject.id, 3, 'PENDING');
    expect((await getProgress(agent)).general).toMatchObject({
      total: 3,
      completed: 0,
      percentage: 0,
    });
    await prisma.activity.updateMany({ data: { status: 'COMPLETED', completedAt: NOW } });
    expect((await getProgress(agent)).general).toMatchObject({
      total: 3,
      completed: 3,
      percentage: 100,
    });
  });
});

describe('progress by subject', () => {
  async function seed() {
    const ctx = await setupUser(app, 'a@example.com', 'Redes');
    const bases = await subjectOf(ctx.agent, ctx.period.id, 'Bases de Datos');
    const vacia = await subjectOf(ctx.agent, ctx.period.id, 'Vacía');
    await add(ctx.agent, ctx.subject.id, 3, 'COMPLETED'); // Redes: 3 of 4
    await add(ctx.agent, ctx.subject.id, 1, 'PENDING');
    await add(ctx.agent, bases.id, 1, 'COMPLETED'); // Bases: 1 of 6
    await add(ctx.agent, bases.id, 4, 'PENDING');
    await add(ctx.agent, bases.id, 1, 'IN_PROGRESS');
    return { ...ctx, bases, vacia };
  }

  it('each subject has its own counts', async () => {
    const { agent } = await seed();
    const { subjects, general } = await getProgress(agent);
    const by = Object.fromEntries(subjects.map((s) => [s.name, s]));
    expect(by['Redes']).toMatchObject({
      total: 4,
      completed: 3,
      pending: 1,
      inProgress: 0,
      percentage: 75,
    });
    expect(by['Bases de Datos']).toMatchObject({
      total: 6,
      completed: 1,
      pending: 4,
      inProgress: 1,
      percentage: 17,
    });
    expect(by['Vacía']).toMatchObject({ total: 0, completed: 0, percentage: 0 });
    expect(general).toMatchObject({ total: 10, completed: 4, percentage: 40 });
  });

  it('a subject without activities is listed with total 0 (the UI shows "sin actividades", not 0 %)', async () => {
    const { agent, vacia } = await seed();
    const s = (await getProgress(agent)).subjects.find((x) => x.id === vacia.id)!;
    expect(s.total).toBe(0);
  });

  it('is sorted alphabetically and stays stable when progress changes', async () => {
    const { agent, bases } = await seed();
    const before = (await getProgress(agent)).subjects.map((s) => s.name);
    expect(before).toEqual(['Bases de Datos', 'Redes', 'Vacía']);
    await add(agent, bases.id, 20, 'COMPLETED'); // Bases jumps to the best progress
    expect((await getProgress(agent)).subjects.map((s) => s.name)).toEqual(before);
  });

  it('is unweighted: priority, type and subject do not change the percentage', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await add(agent, subject.id, 1, 'COMPLETED');
    await add(agent, subject.id, 1, 'PENDING');
    await prisma.activity.updateMany({
      where: { status: 'COMPLETED' },
      data: { priority: 'LOW', type: 'READING' },
    });
    await prisma.activity.updateMany({
      where: { status: 'PENDING' },
      data: { priority: 'HIGH', type: 'EXAM' },
    });
    expect((await getProgress(agent)).general.percentage).toBe(50);
  });
});

describe('overdue activities', () => {
  it('stay in pending / in progress, are also counted as overdue per subject, and never change the percentage', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const bases = await subjectOf(agent, period.id, 'Bases');
    await add(agent, subject.id, 2, 'PENDING', -3); // 2 overdue
    await add(agent, subject.id, 1, 'IN_PROGRESS', -1); // 1 overdue
    await add(agent, subject.id, 1, 'COMPLETED', -10); // finished: not overdue
    await add(agent, bases.id, 1, 'PENDING', 5); // future
    const p = await getProgress(agent);
    const redes = p.subjects.find((s) => s.name === 'Redes')!;
    expect(redes).toMatchObject({
      pending: 2,
      inProgress: 1,
      completed: 1,
      overdue: 3,
      total: 4,
      percentage: 25,
    });
    expect(p.subjects.find((s) => s.name === 'Bases')!.overdue).toBe(0);
    expect(p.general).toMatchObject({
      overdue: 3,
      pending: 3,
      inProgress: 1,
      total: 5,
      percentage: 20,
    });
  });

  it('overdue only strictly after the deadline: due exactly now is not overdue yet', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const id = (await postActivity(agent, subject.id, {})).body.activity.id as string;
    await prisma.activity.update({ where: { id }, data: { dueAt: NOW } });
    expect((await getProgress(agent)).general.overdue).toBe(0);
    now = new Date(NOW.getTime() + 1);
    expect((await getProgress(agent)).general.overdue).toBe(1);
  });
});

describe('scope: only the user’s activities of the CURRENT period', () => {
  it('ignores activities and subjects of another period', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    await add(agent, subject.id, 1, 'PENDING');
    const old = (
      await agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Anterior', startDate: '2026-01-15', endDate: '2026-06-30' })
    ).body.period;
    const oldSubject = await subjectOf(agent, old.id, 'Vieja');
    await add(agent, oldSubject.id, 9, 'COMPLETED');
    const p = await getProgress(agent);
    expect(p.general).toMatchObject({ total: 1, completed: 0, percentage: 0 });
    expect(p.subjects.map((s) => s.name)).toEqual(['Redes']);
  });

  it('never counts another user’s activities or lists their subjects', async () => {
    const a = await setupUser(app, 'a@example.com', 'Redes');
    const b = await setupUser(app, 'b@example.com', 'Redes');
    await add(a.agent, a.subject.id, 1, 'PENDING');
    await add(b.agent, b.subject.id, 8, 'COMPLETED');
    const p = await getProgress(a.agent);
    expect(p.general.total).toBe(1);
    expect(p.subjects).toHaveLength(1);
    expect(p.subjects[0]!.id).toBe(a.subject.id);
    expect((await getProgress(b.agent)).general).toMatchObject({ total: 8, percentage: 100 });
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
    const res = await agent.get('/api/progress');
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    return { count: queries.length, ms, progress: progressResponseSchema.parse(res.body).progress };
  }

  it('uses the same number of queries for 1 subject / 5 activities as for 20 subjects / 500 activities', async () => {
    const { agent, user, period, subject } = await setupUser(loggedApp, 'perf@example.com');
    const statuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
    const seed = (subjectId: string, n: number) =>
      prisma.activity.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          userId: user.id,
          subjectId,
          title: `bulk ${i}`,
          type: 'TASK' as const,
          priority: 'MEDIUM' as const,
          status: statuses[i % 3]!,
          completedAt: statuses[i % 3] === 'COMPLETED' ? NOW : null,
          dueAt: new Date(NOW.getTime() + ((i % 40) - 10) * DAY),
          hasTime: true,
        })),
      });
    await seed(subject.id, 5);
    const small = await measure(agent);

    const ids = [subject.id];
    for (let s = 1; s < 20; s++)
      ids.push((await subjectOf(agent, period.id, `Asignatura ${String(s).padStart(2, '0')}`)).id);
    for (const id of ids) await seed(id, 25); // 20 x 25 = 500 (+5)
    const large = await measure(agent);

    expect(small.progress.general.total).toBe(5);
    expect(large.progress.general.total).toBe(505);
    expect(large.progress.subjects).toHaveLength(20);
    expect(large.count).toBe(small.count);
    expect(large.count).toBeLessThanOrEqual(6); // session + period + subjects + 2 grouped counts (+ lastUsedAt touch)
    console.info(
      `progress: ${large.count} queries, ${large.ms.toFixed(0)} ms for 20 subjects / 505 activities`,
    );
    expect(large.ms).toBeLessThan(1500);
  });
});
