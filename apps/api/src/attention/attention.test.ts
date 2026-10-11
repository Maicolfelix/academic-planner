import { PrismaPg } from '@prisma/adapter-pg';
import {
  ATTENTION_ALTERNATIVES_LIMIT,
  attentionResponseSchema,
  type ActivityPriority,
  type ActivityStatus,
  type Attention,
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

const getAttention = async (agent: request.Agent): Promise<Attention> => {
  const res = await agent.get('/api/attention');
  expect(res.status).toBe(200);
  return attentionResponseSchema.parse(res.body).attention; // also validates the whole shape
};
const titles = (a: Attention) =>
  [a.recommendation, ...a.alternatives].filter(Boolean).map((i) => i!.activity.title);

/** Creates an activity and pins its deadline to an exact instant relative to NOW. */
async function mk(
  agent: request.Agent,
  subjectId: string,
  title: string,
  offsetMs: number,
  opts: { priority?: ActivityPriority; status?: ActivityStatus } = {},
) {
  const id = (await postActivity(agent, subjectId, { title, dueDate: '2099-01-01' })).body.activity
    .id as string;
  await prisma.activity.update({
    where: { id },
    data: {
      dueAt: new Date(NOW.getTime() + offsetMs),
      priority: opts.priority ?? 'MEDIUM',
      status: opts.status ?? 'PENDING',
      completedAt: opts.status === 'COMPLETED' ? NOW : null,
    },
  });
  return id;
}

describe('GET /api/attention — access', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/api/attention');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is never cached', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect((await agent.get('/api/attention')).headers['cache-control']).toBe('no-store');
  });

  it('a user without a period gets an empty answer, not an error', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await getAttention(agent);
    expect(a.period).toBeNull();
    expect(a.recommendation).toBeNull();
    expect(a.alternatives).toEqual([]);
  });

  it('ignores a userId or periodId in the query string: scope always comes from the session', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia de B');
    await mk(a.agent, a.subject.id, 'de A', 2 * DAY);
    await mk(b.agent, b.subject.id, 'de B', HOUR, { priority: 'HIGH' });
    const res = await a.agent.get(`/api/attention?userId=${b.user.id}&periodId=${b.period.id}`);
    const r = attentionResponseSchema.parse(res.body).attention;
    expect(r.period?.id).toBe(a.period.id);
    expect(titles(r)).toEqual(['de A']);
  });
});

describe('nothing to recommend', () => {
  it('no activities: recommendation is null', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const a = await getAttention(agent);
    expect(a.recommendation).toBeNull();
    expect(a.alternatives).toEqual([]);
    expect(a.period).not.toBeNull();
  });

  it('only completed activities: recommendation is null', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'hecha 1', HOUR, { status: 'COMPLETED', priority: 'HIGH' });
    await mk(agent, subject.id, 'hecha 2', -DAY, { status: 'COMPLETED' });
    const a = await getAttention(agent);
    expect(a.recommendation).toBeNull();
    expect(a.alternatives).toEqual([]);
  });
});

describe('a known set', () => {
  async function seed() {
    const ctx = await setupUser(app, 'a@example.com', 'Redes');
    const { agent, subject } = ctx;
    await mk(agent, subject.id, 'baja en 5 h', 5 * HOUR, { priority: 'LOW' });
    await mk(agent, subject.id, 'alta en 5 días', 5 * DAY, { priority: 'HIGH' });
    await mk(agent, subject.id, 'baja en 10 días', 10 * DAY, { priority: 'LOW' });
    await mk(agent, subject.id, 'media en 2 días', 2 * DAY, { priority: 'MEDIUM' });
    await mk(agent, subject.id, 'finalizada urgente', HOUR, {
      priority: 'HIGH',
      status: 'COMPLETED',
    });
    return ctx;
  }

  it('recommends the LOW priority activity due in 5 hours, then the next two, and never the completed one', async () => {
    const { agent, subject } = await seed();
    const a = await getAttention(agent);
    expect(a.recommendation!.activity.title).toBe('baja en 5 h');
    expect(a.alternatives.map((i) => i.activity.title)).toEqual([
      'media en 2 días',
      'alta en 5 días',
    ]);
    expect(a.recommendation!.activity.subject).toMatchObject({ id: subject.id, name: 'Redes' });
    expect(JSON.stringify(a)).not.toContain('finalizada urgente');
    expect(a.generatedAt).toBe(NOW.toISOString());
  });

  it('gives human reasons and never the internal score', async () => {
    const { agent } = await seed();
    const a = await getAttention(agent);
    expect(a.recommendation!.radarStatus).toBe('IMMEDIATE');
    expect(a.recommendation!.reasons).toEqual(['Vence en menos de 24 horas.']); // LOW: priority is not a reason
    expect(a.alternatives[0]!.radarStatus).toBe('UPCOMING');
    expect(a.alternatives[0]!.reasons).toEqual(['Vence en los próximos 3 días.']); // MEDIUM: not a reason
    expect(a.alternatives[1]!.radarStatus).toBe('PLANNABLE');
    expect(a.alternatives[1]!.reasons).toEqual([
      'Vence durante esta semana.',
      'Tiene prioridad alta.',
    ]);
    expect(JSON.stringify(a)).not.toMatch(/score|"points"/i);
  });

  it('a HIGH priority far deadline does not beat a LOW priority urgent one', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'alta lejana', 10 * DAY, { priority: 'HIGH' });
    await mk(agent, subject.id, 'baja urgente', 2 * HOUR, { priority: 'LOW' });
    expect((await getAttention(agent)).recommendation!.activity.title).toBe('baja urgente');
  });

  it('inside the same category HIGH goes first', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'baja en 2 días', 2 * DAY, { priority: 'LOW' });
    await mk(agent, subject.id, 'alta en 3 días', 3 * DAY, { priority: 'HIGH' });
    const a = await getAttention(agent);
    expect(a.recommendation!.activity.title).toBe('alta en 3 días');
  });

  it('IN_PROGRESS adds its reason and breaks a tie in its favor', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'pendiente', 5 * HOUR, { priority: 'HIGH' });
    await mk(agent, subject.id, 'en proceso', 5 * HOUR + 60_000, {
      priority: 'HIGH',
      status: 'IN_PROGRESS',
    });
    const a = await getAttention(agent);
    expect(a.recommendation!.activity.title).toBe('en proceso');
    expect(a.recommendation!.reasons).toEqual([
      'Vence en menos de 24 horas.',
      'Tiene prioridad alta.',
      'Ya comenzaste esta actividad.',
    ]);
  });

  it('returns at most one recommendation and the documented number of alternatives', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    for (let i = 1; i <= 8; i++) await mk(agent, subject.id, `a${i}`, i * HOUR);
    const a = await getAttention(agent);
    expect(a.alternatives).toHaveLength(ATTENTION_ALTERNATIVES_LIMIT);
    expect(titles(a)).toEqual(['a1', 'a2', 'a3']);
  });

  it('with one open activity there are no alternatives', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'única', 12 * DAY);
    const a = await getAttention(agent);
    expect(a.recommendation!.activity.title).toBe('única');
    expect(a.recommendation!.radarStatus).toBe('UNDER_CONTROL');
    expect(a.recommendation!.reasons).toEqual(['La fecha límite aún está a más de una semana.']);
    expect(a.alternatives).toEqual([]);
  });
});

describe('overdue activities', () => {
  it('an activity overdue since yesterday is recommended, with calm, factual reasons', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'vencida ayer', -DAY, { priority: 'HIGH' });
    await mk(agent, subject.id, 'inmediata', 2 * HOUR, { priority: 'HIGH' });
    const a = await getAttention(agent);
    expect(a.recommendation!.activity.title).toBe('vencida ayer');
    expect(a.recommendation!.radarStatus).toBe('OVERDUE');
    expect(a.recommendation!.reasons).toEqual([
      'Esta actividad ya está vencida.',
      'Venció ayer.',
      'Tiene prioridad alta.',
    ]);
  });

  it('one overdue for 30 days does not dominate: something due in 1 hour goes first', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'vencida hace 30 días', -30 * DAY, {
      priority: 'HIGH',
      status: 'IN_PROGRESS',
    });
    await mk(agent, subject.id, 'en 1 hora', HOUR, { priority: 'LOW' });
    const a = await getAttention(agent);
    expect(titles(a)).toEqual(['en 1 hora', 'vencida hace 30 días']);
    expect(a.alternatives[0]!.radarStatus).toBe('OVERDUE'); // still an overdue activity for the Radar
    expect(a.alternatives[0]!.reasons[1]).toBe('Venció hace 30 días.');
  });

  it('when everything is overdue one is still recommended', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'vieja', -40 * DAY);
    await mk(agent, subject.id, 'menos vieja', -20 * DAY);
    const a = await getAttention(agent);
    expect(a.recommendation!.radarStatus).toBe('OVERDUE');
    expect(titles(a)).toEqual(['vieja', 'menos vieja']);
  });
});

describe('the ranking is applied by the service, never inherited from the database order', () => {
  it('the query returns the stale overdue one first (earliest deadline) but it is not recommended first', async () => {
    const { agent, subject, user } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'vieja', -90 * DAY);
    await mk(agent, subject.id, 'urgente', 3 * HOUR);
    // The raw query (what the repository does) really starts with the oldest deadline:
    const raw = await prisma.activity.findMany({
      where: { userId: user.id },
      orderBy: { dueAt: 'asc' },
    });
    expect(raw[0]!.title).toBe('vieja');
    expect(titles(await getAttention(agent))[0]).toBe('urgente');
  });

  it('is deterministic: the same data gives the same answer, and equal activities resolve by creation order', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const due = 2 * DAY;
    await mk(agent, subject.id, 'gemela 1', due);
    await mk(agent, subject.id, 'gemela 2', due);
    await mk(agent, subject.id, 'gemela 3', due);
    // Same priority, status and deadline: the engine falls back to creation time, then id.
    const first = await getAttention(agent);
    const second = await getAttention(agent);
    expect(first).toEqual({ ...second });
    expect(titles(first)).toEqual(['gemela 1', 'gemela 2', 'gemela 3']);
  });
});

describe('scope: only the user’s open activities of the CURRENT period', () => {
  it('excludes other users and other periods', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await mk(a.agent, a.subject.id, 'mía', 2 * DAY, { priority: 'LOW' });
    await mk(b.agent, b.subject.id, 'de B', HOUR, { priority: 'HIGH' });

    const old = (
      await a.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Anterior', startDate: '2026-01-15', endDate: '2026-06-30' })
    ).body.period;
    const oldSubject = (
      await a.agent.post('/api/subjects').send({ periodId: old.id, name: 'Vieja' })
    ).body.subject;
    await mk(a.agent, oldSubject.id, 'de otro periodo', HOUR, { priority: 'HIGH' });

    const r = await getAttention(a.agent);
    expect(titles(r)).toEqual(['mía']);
    expect(JSON.stringify(r)).not.toMatch(/de B|otro periodo/);
  });
});

describe('it follows the data and the clock with no stored state', () => {
  it('completing the recommended activity changes the recommendation immediately', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const first = await mk(agent, subject.id, 'primera', 3 * HOUR);
    await mk(agent, subject.id, 'segunda', 2 * DAY);
    expect((await getAttention(agent)).recommendation!.activity.title).toBe('primera');
    await agent.patch(`/api/activities/${first}`).send({ status: 'COMPLETED' }).expect(200);
    const a = await getAttention(agent);
    expect(a.recommendation!.activity.title).toBe('segunda');
    expect(a.alternatives).toEqual([]);
  });

  it('changing a priority or a status through the API changes the ranking', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const proyecto = await mk(agent, subject.id, 'proyecto', 5 * DAY, { priority: 'HIGH' });
    const quiz = await mk(agent, subject.id, 'quiz', 5 * DAY + HOUR, { priority: 'MEDIUM' });
    expect((await getAttention(agent)).recommendation!.activity.title).toBe('proyecto');
    await agent.patch(`/api/activities/${proyecto}`).send({ priority: 'LOW' }).expect(200);
    expect((await getAttention(agent)).recommendation!.activity.title).toBe('quiz');
    await agent
      .patch(`/api/activities/${proyecto}`)
      .send({ priority: 'MEDIUM', status: 'IN_PROGRESS' })
      .expect(200);
    const a = await getAttention(agent);
    expect(a.recommendation!.activity.title).toBe('proyecto'); // MEDIUM + started, due earlier
    expect(a.recommendation!.reasons).toContain('Ya comenzaste esta actividad.');
    await agent.delete(`/api/activities/${proyecto}`).expect(204);
    expect((await getAttention(agent)).recommendation!.activity.id).toBe(quiz);
  });

  it('time alone moves the recommendation, with no write', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const near = await mk(agent, subject.id, 'cercana, prioridad baja', 30 * HOUR, {
      priority: 'LOW',
    });
    await mk(agent, subject.id, 'lejana, prioridad alta', 10 * DAY, { priority: 'HIGH' });
    const before = await prisma.activity.findMany({ orderBy: { title: 'asc' } });

    expect((await getAttention(agent)).recommendation!.radarStatus).toBe('UPCOMING');
    now = new Date(NOW.getTime() + 8 * HOUR); // 22 h left: now IMMEDIATE
    const later = await getAttention(agent);
    expect(later.recommendation!.activity.id).toBe(near);
    expect(later.recommendation!.radarStatus).toBe('IMMEDIATE');
    expect(later.recommendation!.reasons).toEqual(['Vence en menos de 24 horas.']);
    expect(await prisma.activity.findMany({ orderBy: { title: 'asc' } })).toEqual(before);
  });

  it('does not depend on reminders', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'sin recordatorios', 4 * HOUR);
    await prisma.reminder.deleteMany();
    expect((await getAttention(agent)).recommendation!.activity.title).toBe('sin recordatorios');
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
    const res = await agent.get('/api/attention');
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    return {
      count: queries.length,
      ms,
      attention: attentionResponseSchema.parse(res.body).attention,
    };
  }

  async function seedMany(userId: string, subjectId: string, n: number) {
    const priorities = ['LOW', 'MEDIUM', 'HIGH'] as const;
    const { periodId } = await prisma.subject.findUniqueOrThrow({ where: { id: subjectId } });
    await prisma.activity.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        userId,
        periodId,
        subjectId,
        title: `bulk ${i}`,
        type: 'TASK' as const,
        priority: priorities[i % 3]!,
        status: i % 7 === 0 ? ('IN_PROGRESS' as const) : ('PENDING' as const),
        dueAt: new Date(NOW.getTime() + ((i % 50) / 50) * 17 * DAY - 3 * DAY),
        hasTime: true,
      })),
    });
  }

  it('uses the same number of queries for 5 activities as for 200 (no query per candidate)', async () => {
    const { agent, user, subject } = await setupUser(loggedApp, 'perf@example.com');
    await seedMany(user.id, subject.id, 5);
    const small = await measure(agent);
    await seedMany(user.id, subject.id, 195);
    const large = await measure(agent);

    expect(small.attention.recommendation).not.toBeNull();
    expect(large.attention.recommendation).not.toBeNull();
    expect(large.attention.alternatives).toHaveLength(ATTENTION_ALTERNATIVES_LIMIT);
    expect(large.count).toBe(small.count);
    expect(large.count).toBeLessThanOrEqual(4); // session + current period + open activities (+ lastUsedAt touch)
    console.info(`attention: ${large.count} queries, ${large.ms.toFixed(0)} ms for 200 activities`);
    expect(large.ms).toBeLessThan(1500);
  });
});

describe('GET /api/attention: upcoming (the Home hero walks through them)', () => {
  it('lists the open activities by deadline, soonest first, at most five, never finished or forgotten ones', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, 'Tercera', 3 * DAY, { priority: 'HIGH' });
    await mk(agent, subject.id, 'Primera', 2 * HOUR, { priority: 'LOW' });
    await mk(agent, subject.id, 'Segunda', DAY);
    await mk(agent, subject.id, 'Hecha', HOUR, { status: 'COMPLETED' });
    await mk(agent, subject.id, 'Olvidada', -30 * DAY);
    for (const [i, t] of ['Cuarta', 'Quinta', 'Sexta', 'Séptima'].entries()) {
      await mk(agent, subject.id, t, (4 + i) * DAY);
    }
    const a = await getAttention(agent);
    expect(a.upcoming.map((i) => i.activity.title)).toEqual([
      'Primera',
      'Segunda',
      'Tercera',
      'Cuarta',
      'Quinta',
    ]);
    // Each one carries its own reasons and Radar state, like the recommendation.
    expect(a.upcoming.every((i) => i.reasons.length > 0)).toBe(true);
  });

  it('changes with the data: finishing the first one and moving a deadline reorder it', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const first = await mk(agent, subject.id, 'A', 2 * HOUR);
    const second = await mk(agent, subject.id, 'B', DAY);
    await mk(agent, subject.id, 'C', 2 * DAY);
    expect((await getAttention(agent)).upcoming.map((i) => i.activity.title)).toEqual([
      'A',
      'B',
      'C',
    ]);
    await agent.patch(`/api/activities/${first}`).send({ status: 'COMPLETED' });
    expect((await getAttention(agent)).upcoming.map((i) => i.activity.title)).toEqual(['B', 'C']);
    await prisma.activity.update({
      where: { id: second },
      data: { dueAt: new Date(NOW.getTime() + 5 * DAY) },
    });
    expect((await getAttention(agent)).upcoming.map((i) => i.activity.title)).toEqual(['C', 'B']);
  });

  it('is empty without a period and when nothing is open', async () => {
    const { agent } = await signUp(app, 'noperiod@example.com');
    expect((await getAttention(agent)).upcoming).toEqual([]);
    const other = await setupUser(app, 'b@example.com');
    expect((await getAttention(other.agent)).upcoming).toEqual([]);
  });
});
