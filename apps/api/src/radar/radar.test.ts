import { PrismaPg } from '@prisma/adapter-pg';
import {
  RADAR_GROUP_LIMIT,
  RADAR_KEYS,
  RADAR_STATUSES,
  calculateRadarStatus,
  radarResponseSchema,
  type ActivityStatus,
  type Radar,
  type RadarStatus,
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const getRadar = async (agent: request.Agent): Promise<Radar> => {
  const res = await agent.get('/api/radar');
  expect(res.status).toBe(200);
  return radarResponseSchema.parse(res.body).radar; // also validates the whole shape
};
const titles = (list: { title: string }[]) => list.map((a) => a.title);

/** Creates an activity and then pins its deadline to an exact instant (the API only takes minutes). */
async function mk(
  agent: request.Agent,
  subjectId: string,
  title: string,
  offsetMs: number,
  status?: ActivityStatus,
) {
  const id = (await postActivity(agent, subjectId, { title, dueDate: '2099-01-01' })).body.activity
    .id as string;
  await prisma.activity.update({
    where: { id },
    data: { dueAt: new Date(NOW.getTime() + offsetMs) },
  });
  if (status)
    await prisma.activity.update({
      where: { id },
      data: { status, completedAt: status === 'COMPLETED' ? NOW : null },
    });
  return id;
}

describe('GET /api/radar — access', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/api/radar');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is never cached', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect((await agent.get('/api/radar')).headers['cache-control']).toBe('no-store');
  });

  it('a user without a period gets an empty radar, not an error', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const r = await getRadar(agent);
    expect(r.period).toBeNull();
    expect(Object.values(r.summary)).toEqual([0, 0, 0, 0, 0]);
    expect(Object.values(r.groups).flat()).toEqual([]);
  });

  it('ignores a userId or periodId in the query string: scope always comes from the session', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia de B');
    await mk(a.agent, a.subject.id, 'de A', 2 * DAY);
    await mk(b.agent, b.subject.id, 'de B', 2 * DAY);
    const res = await a.agent.get(`/api/radar?userId=${b.user.id}&periodId=${b.period.id}`);
    const r = radarResponseSchema.parse(res.body).radar;
    expect(r.period?.id).toBe(a.period.id);
    expect(titles(r.groups.upcoming)).toEqual(['de A']);
  });
});

describe('a known set: one activity per category plus a completed one', () => {
  async function seed() {
    const ctx = await setupUser(app, 'a@example.com', 'Redes');
    const { agent, subject } = ctx;
    await mk(agent, subject.id, 'vencida', -2 * DAY);
    await mk(agent, subject.id, 'inmediata', 5 * HOUR);
    await mk(agent, subject.id, 'proxima', 2 * DAY);
    await mk(agent, subject.id, 'planificable', 5 * DAY);
    await mk(agent, subject.id, 'bajo control', 12 * DAY);
    await mk(agent, subject.id, 'finalizada', 5 * HOUR, 'COMPLETED');
    return ctx;
  }

  it('summary and groups hold exactly the right activity, and the completed one is excluded', async () => {
    const { agent, subject } = await seed();
    const r = await getRadar(agent);

    expect(r.summary).toEqual({
      overdue: 1,
      immediate: 1,
      upcoming: 1,
      plannable: 1,
      underControl: 1,
    });
    expect(titles(r.groups.overdue)).toEqual(['vencida']);
    expect(titles(r.groups.immediate)).toEqual(['inmediata']);
    expect(titles(r.groups.upcoming)).toEqual(['proxima']);
    expect(titles(r.groups.plannable)).toEqual(['planificable']);
    expect(titles(r.groups.underControl)).toEqual(['bajo control']);
    expect(JSON.stringify(r)).not.toContain('finalizada');
    expect(r.generatedAt).toBe(NOW.toISOString());
    expect(r.groups.immediate[0]!.subject).toMatchObject({ id: subject.id, name: 'Redes' });
  });

  it('IN_PROGRESS activities take part like PENDING ones', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'en proceso', 5 * HOUR, 'IN_PROGRESS');
    expect(titles((await getRadar(agent)).groups.immediate)).toEqual(['en proceso']);
  });

  it('time alone moves an activity down the categories, with no write at all', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const id = await mk(agent, subject.id, 'viajera', 10 * DAY);
    const before = await prisma.activity.findUniqueOrThrow({ where: { id } });

    const seen: RadarStatus[] = [];
    for (const days of [0, 4, 8, 9.5, 9.9, 10.5]) {
      now = new Date(NOW.getTime() + days * DAY);
      const r = await getRadar(agent);
      seen.push(RADAR_STATUSES.find((s) => r.summary[RADAR_KEYS[s]] === 1)!);
    }
    expect(seen).toEqual([
      'UNDER_CONTROL',
      'PLANNABLE',
      'UPCOMING',
      'IMMEDIATE',
      'IMMEDIATE',
      'OVERDUE',
    ]);
    expect(await prisma.activity.findUniqueOrThrow({ where: { id } })).toEqual(before); // untouched
  });

  it('is independent from priority: LOW due in 2 h is IMMEDIATE, HIGH due in 10 days is UNDER_CONTROL', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const low = await mk(agent, subject.id, 'baja pero ya', 2 * HOUR);
    const high = await mk(agent, subject.id, 'alta pero lejos', 10 * DAY);
    await prisma.activity.update({ where: { id: low }, data: { priority: 'LOW' } });
    await prisma.activity.update({ where: { id: high }, data: { priority: 'HIGH' } });
    const r = await getRadar(agent);
    expect(titles(r.groups.immediate)).toEqual(['baja pero ya']);
    expect(titles(r.groups.underControl)).toEqual(['alta pero lejos']);
  });

  it('does not depend on reminders: no reminder is due and the activity is still IMMEDIATE', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'sin recordatorio due', 5 * HOUR);
    await prisma.reminder.deleteMany();
    expect(titles((await getRadar(agent)).groups.immediate)).toEqual(['sin recordatorio due']);
  });
});

describe('scope: only the user’s open activities of the CURRENT period', () => {
  it('excludes other users and other periods', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await mk(a.agent, a.subject.id, 'mía', 5 * HOUR);
    await mk(b.agent, b.subject.id, 'de B', 5 * HOUR);

    const old = (
      await a.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Anterior', startDate: '2026-01-15', endDate: '2026-06-30' })
    ).body.period;
    const oldSubject = (
      await a.agent.post('/api/subjects').send({ periodId: old.id, name: 'Vieja' })
    ).body.subject;
    await mk(a.agent, oldSubject.id, 'de otro periodo', 5 * HOUR);

    const r = await getRadar(a.agent);
    expect(titles(r.groups.immediate)).toEqual(['mía']);
    expect(r.summary.immediate).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/de B|otro periodo/);
  });
});

describe('exact boundaries through the API (deadlines pinned to the millisecond)', () => {
  const cases: [string, number, RadarStatus][] = [
    ['1 ms overdue', -1, 'OVERDUE'],
    ['exactly now', 0, 'IMMEDIATE'],
    ['23:59:59 left', 24 * HOUR - 1000, 'IMMEDIATE'],
    ['24 h exactly', 24 * HOUR, 'UPCOMING'],
    ['24 h + 1 ms', 24 * HOUR + 1, 'UPCOMING'],
    ['72 h exactly', 72 * HOUR, 'UPCOMING'],
    ['72 h + 1 ms', 72 * HOUR + 1, 'PLANNABLE'],
    ['7 days exactly', 7 * DAY, 'PLANNABLE'],
    ['7 days + 1 ms', 7 * DAY + 1, 'UNDER_CONTROL'],
  ];

  async function seedBoundaries() {
    const ctx = await setupUser(app, 'a@example.com');
    for (const [label, ms] of cases) await mk(ctx.agent, ctx.subject.id, label, ms);
    return ctx;
  }

  it('GET /api/radar puts each one in the expected group', async () => {
    const { agent } = await seedBoundaries();
    const r = await getRadar(agent);
    for (const [label, , expected] of cases) {
      const where = RADAR_STATUSES.filter((s) => titles(r.groups[RADAR_KEYS[s]]).includes(label));
      expect(where, label).toEqual([expected]);
    }
  });

  it('GET /api/activities?radar=X filters on the server and agrees with the Radar for every category', async () => {
    const { agent } = await seedBoundaries();
    for (const status of RADAR_STATUSES) {
      const res = await agent.get(`/api/activities?radar=${status}`);
      expect(res.status).toBe(200);
      const expected = cases.filter(([, , s]) => s === status).map(([label]) => label);
      expect(titles(res.body.activities).sort(), status).toEqual([...expected].sort());
    }
  });

  it('the filter ranges and the core function classify every probe the same way', async () => {
    const { agent } = await seedBoundaries();
    const all = (await agent.get('/api/activities')).body.activities as {
      title: string;
      dueAt: string;
      status: string;
    }[];
    for (const a of all) {
      const status = calculateRadarStatus(a as never, NOW)!;
      const res = await agent.get(`/api/activities?radar=${status}`);
      expect(titles(res.body.activities)).toContain(a.title);
    }
  });
});

describe('GET /api/activities?radar=', () => {
  it('never returns completed activities, whatever their deadline', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'abierta', 5 * HOUR);
    await mk(agent, subject.id, 'cerrada', 5 * HOUR, 'COMPLETED');
    await mk(agent, subject.id, 'cerrada vencida', -DAY, 'COMPLETED');
    expect(titles((await agent.get('/api/activities?radar=IMMEDIATE')).body.activities)).toEqual([
      'abierta',
    ]);
    expect((await agent.get('/api/activities?radar=OVERDUE')).body.activities).toEqual([]);
  });

  it('combines with the other filters (AND) and stays inside the user’s data', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    const other = (
      await a.agent.post('/api/subjects').send({ periodId: a.period.id, name: 'Otra' })
    ).body.subject;
    await mk(a.agent, a.subject.id, 'redes', 5 * HOUR);
    await mk(a.agent, other.id, 'otra', 5 * HOUR);
    await mk(b.agent, b.subject.id, 'de B', 5 * HOUR);

    const both = await a.agent.get(`/api/activities?radar=IMMEDIATE&subjectId=${other.id}`);
    expect(titles(both.body.activities)).toEqual(['otra']);
    const mine = await a.agent.get('/api/activities?radar=IMMEDIATE');
    expect(titles(mine.body.activities).sort()).toEqual(['otra', 'redes']);
    const withStatus = await a.agent.get('/api/activities?radar=IMMEDIATE&status=COMPLETED');
    expect(withStatus.body.activities).toEqual([]); // radar is open-only, so this combination is empty
  });

  it('rejects an unknown category and COMPLETED as a category', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    for (const bad of ['NOPE', 'COMPLETED', 'immediate', '']) {
      const res = await agent.get(`/api/activities?radar=${bad}`);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('ordering and limits', () => {
  it('sorts every group by deadline, so the most overdue comes first', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'hace 1 día', -DAY);
    await mk(agent, subject.id, 'hace 9 días', -9 * DAY);
    await mk(agent, subject.id, 'hace 3 días', -3 * DAY);
    await mk(agent, subject.id, 'en 9 h', 9 * HOUR);
    await mk(agent, subject.id, 'en 2 h', 2 * HOUR);
    const r = await getRadar(agent);
    expect(titles(r.groups.overdue)).toEqual(['hace 9 días', 'hace 3 días', 'hace 1 día']);
    expect(titles(r.groups.immediate)).toEqual(['en 2 h', 'en 9 h']);
  });

  it(`lists at most ${RADAR_GROUP_LIMIT} per group but the summary keeps the real count`, async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    for (let i = 1; i <= 13; i++)
      await mk(agent, subject.id, `i${String(i).padStart(2, '0')}`, i * 60_000);
    await mk(agent, subject.id, 'único bajo control', 20 * DAY);
    const r = await getRadar(agent);
    expect(r.summary.immediate).toBe(13);
    expect(r.groups.immediate).toHaveLength(RADAR_GROUP_LIMIT);
    expect(r.groups.immediate[0]!.title).toBe('i01'); // soonest first
    expect(r.summary.underControl).toBe(1);
    expect(r.groups.underControl).toHaveLength(1);
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
    const res = await agent.get('/api/radar');
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    return { count: queries.length, ms, radar: radarResponseSchema.parse(res.body).radar };
  }

  async function seedMany(userId: string, subjectId: string, n: number) {
    await prisma.activity.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        userId,
        subjectId,
        title: `bulk ${i}`,
        type: 'TASK' as const,
        priority: 'MEDIUM' as const,
        // Spread over -3 days .. +14 days so every category is populated.
        dueAt: new Date(NOW.getTime() + ((i % 50) / 50) * 17 * DAY - 3 * DAY),
        hasTime: true,
      })),
    });
  }

  it('uses the same number of queries for 5 activities as for 200 (no query per activity or category)', async () => {
    const { agent, user, subject } = await setupUser(loggedApp, 'perf@example.com');
    await seedMany(user.id, subject.id, 5);
    const small = await measure(agent);
    await seedMany(user.id, subject.id, 195);
    const large = await measure(agent);

    expect(Object.values(large.radar.summary).reduce((a, b) => a + b, 0)).toBe(200);
    expect(Object.values(small.radar.summary).reduce((a, b) => a + b, 0)).toBe(5);
    expect(large.count).toBe(small.count);
    expect(large.count).toBeLessThanOrEqual(4); // session + current period + open activities (+ lastUsedAt touch)
    // Every category is populated and capped.
    for (const key of Object.values(RADAR_KEYS)) {
      expect(large.radar.summary[key], key).toBeGreaterThan(0);
      expect(large.radar.groups[key].length).toBeLessThanOrEqual(RADAR_GROUP_LIMIT);
    }
    console.info(`radar: ${large.count} queries, ${large.ms.toFixed(0)} ms for 200 activities`);
    expect(large.ms).toBeLessThan(1500);
  });
});
