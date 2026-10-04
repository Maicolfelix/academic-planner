import { PrismaPg } from '@prisma/adapter-pg';
import { dashboardResponseSchema, type Dashboard } from '@planner/core';
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

// "Now" is controlled: 12:00 on Monday 1 June 2026 in Bogotá (UTC-5).
const BOGOTA_NOON = new Date('2026-06-01T17:00:00.000Z');
let now = BOGOTA_NOON;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = BOGOTA_NOON;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const get = async (agent: request.Agent): Promise<Dashboard> => {
  const res = await agent.get('/api/dashboard');
  expect(res.status).toBe(200);
  return dashboardResponseSchema.parse(res.body).dashboard; // also validates the whole shape
};

type Make = { title: string; dueDate: string; dueTime?: string; priority?: string };
async function mk(agent: request.Agent, subjectId: string, a: Make, status?: string) {
  const id = (await postActivity(agent, subjectId, a)).body.activity.id as string;
  if (status) await agent.patch(`/api/activities/${id}`).send({ status }).expect(200);
  return id;
}
const titles = (list: { title: string }[]) => list.map((a) => a.title);

describe('GET /api/dashboard — access', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is never cached', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect((await agent.get('/api/dashboard')).headers['cache-control']).toBe('no-store');
  });

  it('a user without a current period gets an empty dashboard, not an error', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const d = await get(agent);
    expect(d.period).toBeNull();
    expect(d.subjectCount).toBe(0);
    expect(d.summary).toEqual({ total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 });
    expect(d.progress).toEqual({ completed: 0, total: 0, percent: 0 });
    expect([d.nextDue, d.today, d.upcoming, d.overdue]).toEqual([null, [], [], []]);
    expect(d.greeting).toBe('Buenas tardes'); // still personalised
  });

  it('a user with a period but no subjects reports subjectCount 0', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await agent.post('/api/periods').send(periodInput).expect(201);
    const d = await get(agent);
    expect(d.period?.name).toBe('Segundo semestre 2026');
    expect(d.subjectCount).toBe(0);
    expect(d.summary.total).toBe(0);
  });

  it('ignores a userId or periodId sent in the query string: scope always comes from the session', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia de B');
    await mk(a.agent, a.subject.id, { title: 'de A', dueDate: '2099-01-01' });
    await mk(b.agent, b.subject.id, { title: 'de B', dueDate: '2099-01-01' });

    const res = await a.agent.get(`/api/dashboard?userId=${b.user.id}&periodId=${b.period.id}`);
    const d = dashboardResponseSchema.parse(res.body).dashboard;
    expect(d.period?.id).toBe(a.period.id);
    expect(titles(d.upcoming)).toEqual(['de A']);
  });
});

describe('Case A — zero activities', () => {
  it('everything is 0 and the lists are empty', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com');
    const d = await get(agent);

    expect(d.period).toMatchObject({
      id: period.id,
      startDate: '2026-08-03',
      endDate: '2026-11-28',
    });
    expect(d.subjectCount).toBe(1);
    expect(d.summary).toEqual({ total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 });
    expect(d.progress).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(d.nextDue).toBeNull();
    expect([d.today, d.upcoming, d.overdue]).toEqual([[], [], []]);
    expect(d.localDate).toBe('2026-06-01');
    expect(d.greeting).toBe('Buenas tardes');
  });
});

describe('Case B — counters by status', () => {
  it('2 PENDING + 1 IN_PROGRESS + 2 COMPLETED', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, { title: 'p1', dueDate: '2099-01-01' });
    await mk(agent, subject.id, { title: 'p2', dueDate: '2099-01-02' });
    await mk(agent, subject.id, { title: 'ip', dueDate: '2099-01-03' }, 'IN_PROGRESS');
    await mk(agent, subject.id, { title: 'c1', dueDate: '2099-01-04' }, 'COMPLETED');
    await mk(agent, subject.id, { title: 'c2', dueDate: '2099-01-05' }, 'COMPLETED');

    const d = await get(agent);
    expect(d.summary).toEqual({ total: 5, pending: 2, inProgress: 1, completed: 2, overdue: 0 });
    expect(d.progress).toEqual({ completed: 2, total: 5, percent: 40 });
  });

  it('the progress percent follows the documented rounding (1/3 -> 33, 2/3 -> 67)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, { title: 'a', dueDate: '2099-01-01' }, 'COMPLETED');
    await mk(agent, subject.id, { title: 'b', dueDate: '2099-01-02' });
    await mk(agent, subject.id, { title: 'c', dueDate: '2099-01-03' });
    expect((await get(agent)).progress.percent).toBe(33);
    await mk(agent, subject.id, { title: 'd', dueDate: '2099-01-04' }, 'COMPLETED');
    // 2 of 4 now; add one more finished -> 3 of 5 = 60
    await mk(agent, subject.id, { title: 'e', dueDate: '2099-01-05' }, 'COMPLETED');
    expect((await get(agent)).progress).toEqual({ completed: 3, total: 5, percent: 60 });
  });
});

describe('Case C — overdue', () => {
  it('lists open activities past their deadline, most overdue first, and never completed ones', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, { title: 'vieja', dueDate: '2020-01-10' });
    await mk(agent, subject.id, { title: 'menos vieja', dueDate: '2020-06-10' }, 'IN_PROGRESS');
    await mk(
      agent,
      subject.id,
      { title: 'pasada pero finalizada', dueDate: '2020-03-10' },
      'COMPLETED',
    );
    await mk(agent, subject.id, { title: 'futura', dueDate: '2099-01-10' });

    const d = await get(agent);
    expect(titles(d.overdue)).toEqual(['vieja', 'menos vieja']);
    expect(d.summary.overdue).toBe(2);
    expect(d.overdue.every((a) => a.status !== 'COMPLETED')).toBe(true);
    expect(d.summary).toMatchObject({ total: 4, pending: 2, inProgress: 1, completed: 1 });
  });

  it('caps the list at 10 but reports the real total in the summary', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    for (let i = 1; i <= 12; i++) {
      await mk(agent, subject.id, {
        title: `v${String(i).padStart(2, '0')}`,
        dueDate: `2020-01-${String(i).padStart(2, '0')}`,
      });
    }
    const d = await get(agent);
    expect(d.summary.overdue).toBe(12);
    expect(d.overdue).toHaveLength(10);
    expect(d.overdue[0]!.title).toBe('v01'); // most overdue first
  });

  it('an activity is overdue only strictly after its deadline', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    // Due exactly now (12:00 Bogotá): not overdue yet, still due today.
    await mk(agent, subject.id, { title: 'justo ahora', dueDate: '2026-06-01', dueTime: '12:00' });
    expect(titles((await get(agent)).overdue)).toEqual([]);
    expect(titles((await get(agent)).today)).toEqual(['justo ahora']);

    now = new Date(BOGOTA_NOON.getTime() + 1); // one millisecond later
    const later = await get(agent);
    expect(titles(later.overdue)).toEqual(['justo ahora']);
    expect(later.today).toEqual([]);
  });
});

describe('Case D — today (user’s local day, Bogotá)', () => {
  it('puts activities due on the local day in `today`, the rest in their own lists', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, { title: 'hoy sin hora', dueDate: '2026-06-01' }); // 23:59:59.999 local
    await mk(agent, subject.id, { title: 'hoy 20:00', dueDate: '2026-06-01', dueTime: '20:00' });
    await mk(agent, subject.id, {
      title: 'hoy 08:00 (ya pasó)',
      dueDate: '2026-06-01',
      dueTime: '08:00',
    });
    await mk(agent, subject.id, { title: 'mañana', dueDate: '2026-06-02' });
    await mk(agent, subject.id, { title: 'ayer', dueDate: '2026-05-31' });
    await mk(
      agent,
      subject.id,
      { title: 'hoy pero finalizada', dueDate: '2026-06-01' },
      'COMPLETED',
    );

    const d = await get(agent);
    expect(titles(d.today)).toEqual(['hoy 20:00', 'hoy sin hora']); // soonest first
    expect(titles(d.upcoming)).toEqual(['mañana']);
    expect(titles(d.overdue)).toEqual(['ayer', 'hoy 08:00 (ya pasó)']); // today's expired deadline counts as overdue
    expect(d.nextDue?.title).toBe('hoy 20:00');
  });

  it('the three lists never share an activity', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    for (const [i, due] of [
      '2020-01-01',
      '2026-06-01',
      '2026-06-01',
      '2026-06-02',
      '2026-06-09',
      '2099-01-01',
    ].entries()) {
      await mk(agent, subject.id, { title: `t${i}`, dueDate: due });
    }
    const d = await get(agent);
    const ids = [...d.overdue, ...d.today, ...d.upcoming].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('upcoming: soonest first, at most 5, no completed, nothing from today', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, { title: 'hoy', dueDate: '2026-06-01' });
    for (let day = 2; day <= 9; day++) {
      await mk(
        agent,
        subject.id,
        { title: `d${day}`, dueDate: `2026-06-0${day}` },
        day === 3 ? 'COMPLETED' : undefined,
      );
    }
    const d = await get(agent);
    expect(titles(d.upcoming)).toEqual(['d2', 'd4', 'd5', 'd6', 'd7']);
    expect(titles(d.today)).toEqual(['hoy']);
  });

  it('nextDue is the first open, not-yet-due activity: today’s before upcoming, null when there is none', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await mk(agent, subject.id, { title: 'vencida', dueDate: '2020-01-01' });
    await mk(agent, subject.id, { title: 'hecha', dueDate: '2099-01-01' }, 'COMPLETED');
    expect((await get(agent)).nextDue).toBeNull();

    await mk(agent, subject.id, { title: 'lejana', dueDate: '2026-07-01' });
    expect((await get(agent)).nextDue?.title).toBe('lejana');
    await mk(agent, subject.id, { title: 'de hoy', dueDate: '2026-06-01' });
    expect((await get(agent)).nextDue?.title).toBe('de hoy');
  });

  it('items carry the subject name and color (joined, not fetched per row)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    await mk(agent, subject.id, { title: 'x', dueDate: '2099-01-01' });
    const [item] = (await get(agent)).upcoming;
    expect(item!.subject).toEqual({ id: subject.id, name: 'Redes', color: '#3B82F6' });
  });
});

describe('Case E — only the current period counts', () => {
  it('ignores activities of another period, and follows the current period when it changes', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com');
    const other = (
      await agent.post('/api/periods').send({
        ...periodInput,
        name: 'Periodo anterior',
        startDate: '2026-01-15',
        endDate: '2026-05-30',
      })
    ).body.period;
    const otherSubject = (
      await agent.post('/api/subjects').send({ periodId: other.id, name: 'Vieja' })
    ).body.subject;

    await mk(agent, subject.id, { title: 'actual 1', dueDate: '2099-01-01' });
    await mk(agent, subject.id, { title: 'actual 2', dueDate: '2099-01-02' }, 'COMPLETED');
    await mk(agent, otherSubject.id, { title: 'anterior', dueDate: '2020-01-01' }); // overdue, but in another period
    await mk(agent, otherSubject.id, { title: 'anterior 2', dueDate: '2099-02-01' }, 'IN_PROGRESS');

    const d = await get(agent);
    expect(d.period?.id).toBe(period.id);
    expect(d.summary).toEqual({ total: 2, pending: 1, inProgress: 0, completed: 1, overdue: 0 });
    expect(titles([...d.overdue, ...d.today, ...d.upcoming])).toEqual(['actual 1']);
    expect(d.subjectCount).toBe(1);

    await agent.patch(`/api/periods/${other.id}`).send({ isCurrent: true }).expect(200);
    const switched = await get(agent);
    expect(switched.period?.id).toBe(other.id);
    expect(switched.summary).toEqual({
      total: 2,
      pending: 1,
      inProgress: 1,
      completed: 0,
      overdue: 1,
    });
    expect(titles(switched.overdue)).toEqual(['anterior']);
  });
});

describe('Case F — another user’s data never appears', () => {
  it('A’s dashboard contains nothing of B (counts, lists, subjects)', async () => {
    const a = await setupUser(app, 'a@example.com', 'Materia A');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await mk(a.agent, a.subject.id, { title: 'de A', dueDate: '2099-01-01' });
    for (let i = 0; i < 4; i++) {
      await mk(
        b.agent,
        b.subject.id,
        { title: `de B ${i}`, dueDate: i < 2 ? '2020-01-01' : '2026-06-01' },
        i === 3 ? 'COMPLETED' : undefined,
      );
    }

    const da = await get(a.agent);
    expect(da.summary).toEqual({ total: 1, pending: 1, inProgress: 0, completed: 0, overdue: 0 });
    expect(JSON.stringify(da)).not.toContain('de B');
    expect(JSON.stringify(da)).not.toContain('Materia B');
    expect(da.subjectCount).toBe(1);

    const db = await get(b.agent);
    expect(db.summary.total).toBe(4);
    expect(JSON.stringify(db)).not.toContain('de A');
  });

  it('a brand-new user gets an empty dashboard', async () => {
    const a = await setupUser(app, 'a@example.com');
    await mk(a.agent, a.subject.id, { title: 'de A', dueDate: '2099-01-01' });
    const c = await setupUser(app, 'c@example.com');
    const d = await get(c.agent);
    expect(d.summary.total).toBe(0);
    expect(d.nextDue).toBeNull();
  });
});

describe('Critical timezone cases: the local day differs from the UTC day', () => {
  it('Asia/Tokyo (UTC+9): at 20:00Z on 1 June it is already 2 June 05:00 for the user', async () => {
    const { agent, user, subject } = await setupUser(app, 'tokyo@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Asia/Tokyo' } });
    now = new Date('2026-06-01T20:00:00.000Z');

    await mk(agent, subject.id, { title: 'hoy en Tokio', dueDate: '2026-06-02' }); // Tokyo end of day = 06-02T14:59:59.999Z
    await mk(agent, subject.id, { title: 'ayer en Tokio', dueDate: '2026-06-01' }); // "today" in UTC, but yesterday in Tokyo
    await mk(agent, subject.id, { title: 'mañana en Tokio', dueDate: '2026-06-03' });

    const d = await get(agent);
    expect(d.localDate).toBe('2026-06-02');
    expect(d.greeting).toBe('Buenos días'); // 05:00 for the user, not 20:00 UTC
    expect(titles(d.today)).toEqual(['hoy en Tokio']);
    expect(titles(d.overdue)).toEqual(['ayer en Tokio']);
    expect(titles(d.upcoming)).toEqual(['mañana en Tokio']);
  });

  it('America/Los_Angeles (UTC-7): at 03:00Z on 2 June it is still the evening of 1 June', async () => {
    const { agent, user, subject } = await setupUser(app, 'la@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'America/Los_Angeles' } });
    now = new Date('2026-06-02T03:00:00.000Z');

    // LA end of 1 June is 06-02T06:59:59.999Z: its UTC date is the 2nd, yet for the user it is today.
    await mk(agent, subject.id, { title: 'hoy en LA', dueDate: '2026-06-01' });
    await mk(agent, subject.id, {
      title: 'hoy en LA 19:00 (ya pasó)',
      dueDate: '2026-06-01',
      dueTime: '19:00',
    });
    await mk(agent, subject.id, { title: 'mañana en LA', dueDate: '2026-06-02' });

    const d = await get(agent);
    expect(d.localDate).toBe('2026-06-01');
    expect(d.greeting).toBe('Buenas noches'); // 20:00 for the user
    expect(titles(d.today)).toEqual(['hoy en LA']);
    expect(titles(d.overdue)).toEqual(['hoy en LA 19:00 (ya pasó)']);
    expect(titles(d.upcoming)).toEqual(['mañana en LA']);
  });

  it('the day rolls over at LOCAL midnight (23:59 vs 00:00 in Los Angeles)', async () => {
    const { agent, user, subject } = await setupUser(app, 'la2@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'America/Los_Angeles' } });
    await mk(agent, subject.id, { title: 'fin del 1', dueDate: '2026-06-01' });

    now = new Date('2026-06-02T06:59:00.000Z'); // 23:59 on 1 June in LA
    let d = await get(agent);
    expect(d.localDate).toBe('2026-06-01');
    expect(titles(d.today)).toEqual(['fin del 1']);

    now = new Date('2026-06-02T07:00:00.000Z'); // 00:00 on 2 June in LA
    d = await get(agent);
    expect(d.localDate).toBe('2026-06-02');
    expect(d.today).toEqual([]);
    expect(titles(d.overdue)).toEqual(['fin del 1']);
  });

  it('greets by the user’s hour in Bogotá across the day', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const greetAt = async (iso: string) => {
      now = new Date(iso);
      return (await get(agent)).greeting;
    };
    expect(await greetAt('2026-06-01T10:00:00.000Z')).toBe('Buenos días'); // 05:00
    expect(await greetAt('2026-06-01T17:00:00.000Z')).toBe('Buenas tardes'); // 12:00
    expect(await greetAt('2026-06-02T00:00:00.000Z')).toBe('Buenas noches'); // 19:00
  });
});

describe('the dashboard follows the data (no stored copies)', () => {
  it('create, status change, reopen and delete are all reflected on the next request', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const keep = await mk(agent, subject.id, { title: 'otra', dueDate: '2099-03-01' });
    const id = await mk(agent, subject.id, { title: 'objetivo', dueDate: '2026-06-05' });

    let d = await get(agent);
    expect(d.summary).toEqual({ total: 2, pending: 2, inProgress: 0, completed: 0, overdue: 0 });
    expect(d.progress.percent).toBe(0);
    expect(d.nextDue?.title).toBe('objetivo');

    // PENDING -> IN_PROGRESS
    await agent.patch(`/api/activities/${id}`).send({ status: 'IN_PROGRESS' }).expect(200);
    d = await get(agent);
    expect(d.summary).toMatchObject({ pending: 1, inProgress: 1, completed: 0 });

    // -> COMPLETED: pending -1, completed +1, progress changes, it leaves the lists
    await agent.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' }).expect(200);
    d = await get(agent);
    expect(d.summary).toEqual({ total: 2, pending: 1, inProgress: 0, completed: 1, overdue: 0 });
    expect(d.progress).toEqual({ completed: 1, total: 2, percent: 50 });
    expect(titles(d.upcoming)).toEqual(['otra']);
    expect(d.nextDue?.title).toBe('otra');

    // reopen
    await agent.patch(`/api/activities/${id}`).send({ status: 'PENDING' }).expect(200);
    d = await get(agent);
    expect(d.summary).toMatchObject({ pending: 2, completed: 0 });
    expect(d.nextDue?.title).toBe('objetivo');

    // reschedule into the past -> becomes overdue
    await agent.patch(`/api/activities/${id}`).send({ dueDate: '2026-05-01' }).expect(200);
    d = await get(agent);
    expect(d.summary.overdue).toBe(1);
    expect(titles(d.overdue)).toEqual(['objetivo']);

    // delete
    await agent.delete(`/api/activities/${id}`).expect(204);
    d = await get(agent);
    expect(d.summary).toEqual({ total: 1, pending: 1, inProgress: 0, completed: 0, overdue: 0 });
    expect(d.overdue).toEqual([]);
    await agent.delete(`/api/activities/${keep}`).expect(204);
    expect((await get(agent)).summary.total).toBe(0);
  });

  it('creating and deleting a subject changes subjectCount', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com');
    expect((await get(agent)).subjectCount).toBe(1);
    const second = (await agent.post('/api/subjects').send({ periodId: period.id, name: 'Bases' }))
      .body.subject;
    expect((await get(agent)).subjectCount).toBe(2);
    await agent.delete(`/api/subjects/${second.id}`).expect(204);
    await agent.delete(`/api/subjects/${subject.id}`).expect(204);
    expect((await get(agent)).subjectCount).toBe(0);
  });
});

describe('efficiency: a constant number of queries, no N+1', () => {
  const queries: string[] = [];
  const logged = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: 'event', level: 'query' }],
  });
  logged.$on('query', (e) => queries.push(e.query));
  const loggedApp = buildApp({ prisma: logged, clock: () => now });
  afterAll(() => logged.$disconnect());

  async function countQueries(agent: request.Agent) {
    queries.length = 0;
    const started = performance.now();
    const res = await agent.get('/api/dashboard');
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    return { count: queries.length, ms };
  }

  it('uses the same number of queries with 3 activities as with 150', async () => {
    const { agent, subject } = await setupUser(loggedApp, 'perf@example.com');
    for (let i = 0; i < 3; i++)
      await mk(agent, subject.id, { title: `s${i}`, dueDate: '2099-01-01' });
    const small = await countQueries(agent);

    // Bulk-insert to keep the test fast: 150 activities across statuses and deadlines.
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'perf@example.com' } });
    const statuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
    await prisma.activity.createMany({
      data: Array.from({ length: 150 }, (_, i) => {
        const status = statuses[i % 3]!;
        return {
          userId: user.id,
          subjectId: subject.id,
          title: `bulk ${i}`,
          status,
          dueAt: new Date(Date.UTC(2026, 0, 1 + (i % 400)) + i),
          completedAt: status === 'COMPLETED' ? new Date('2026-05-01T00:00:00Z') : null,
        };
      }),
    });
    const large = await countQueries(agent);
    const d = await get(agent);

    expect(d.summary.total).toBe(153);
    expect(large.count).toBe(small.count); // does not grow with the data
    // 1 session lookup (+ optional lastUsedAt touch) + 1 current period + 7 parallel queries.
    expect(large.count).toBeLessThanOrEqual(9);
    expect(large.count).toBeGreaterThanOrEqual(7);
    console.info(
      `dashboard: ${large.count} queries, ${large.ms.toFixed(0)} ms with 153 activities`,
    );
    expect(large.ms).toBeLessThan(2000); // generous: only guards against accidental disasters
  });
});
