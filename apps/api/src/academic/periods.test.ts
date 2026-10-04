import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const createPeriod = (agent: request.Agent, body: object = periodInput) =>
  agent.post('/api/periods').send(body);

describe('authentication', () => {
  it('every period endpoint requires a session', async () => {
    const id = randomUUID();
    const calls = [
      request(app).get('/api/periods'),
      request(app).post('/api/periods').send(periodInput),
      request(app).get(`/api/periods/${id}`),
      request(app).patch(`/api/periods/${id}`).send({ name: 'x' }),
      request(app).delete(`/api/periods/${id}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('POST /api/periods', () => {
  it('creates a period owned by the session user and marks the first one as current', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const res = await createPeriod(agent);

    expect(res.status).toBe(201);
    expect(res.body.period).toMatchObject({ ...periodInput, isCurrent: true });
    const row = await prisma.academicPeriod.findUniqueOrThrow({
      where: { id: res.body.period.id },
    });
    expect(row.userId).toBe(user.id);
  });

  it('stores calendar dates as DATE and round-trips them in any server timezone', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const original = process.env.TZ;
    try {
      // +13h and -8h: the zones where a naive Date conversion would shift the day.
      for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'America/Bogota']) {
        process.env.TZ = tz;
        const res = await createPeriod(agent, { ...periodInput, name: tz });
        expect(res.body.period.startDate).toBe('2026-08-03');
        expect(res.body.period.endDate).toBe('2026-11-28');
        const got = await agent.get(`/api/periods/${res.body.period.id}`);
        expect(got.body.period).toMatchObject({ startDate: '2026-08-03', endDate: '2026-11-28' });
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    const [raw] = await prisma.$queryRaw<{ s: string; e: string }[]>`
      SELECT "startDate"::text AS s, "endDate"::text AS e FROM "AcademicPeriod" LIMIT 1`;
    expect(raw).toEqual({ s: '2026-08-03', e: '2026-11-28' });
  });

  it.each([
    ['end before start', { endDate: '2026-07-01' }, 'endDate'],
    ['end equal to start', { endDate: '2026-08-03' }, 'endDate'],
    ['empty name', { name: '   ' }, 'name'],
    ['name over 100 chars', { name: 'x'.repeat(101) }, 'name'],
    ['impossible date', { startDate: '2026-02-30' }, 'startDate'],
    ['malformed date', { endDate: '28/11/2026' }, 'endDate'],
  ])('rejects %s', async (_label, patch, field) => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await createPeriod(agent, { ...periodInput, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[field]).toBeDefined();
    expect(await prisma.academicPeriod.count()).toBe(0);
  });

  it('ignores nothing: a client-sent userId is rejected and no period is created', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { user: other } = await signUp(app, 'b@example.com');
    const res = await createPeriod(agent, { ...periodInput, userId: other.id });
    expect(res.status).toBe(400);
    expect(await prisma.academicPeriod.count()).toBe(0);
  });

  it('a later period is not current unless requested', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await createPeriod(agent);
    const second = await createPeriod(agent, { ...periodInput, name: 'Primero 2027' });
    expect(second.body.period.isCurrent).toBe(false);
  });

  it('marking a new period as current un-marks the previous one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const first = (await createPeriod(agent)).body.period;
    const second = (await createPeriod(agent, { ...periodInput, name: 'Nuevo', isCurrent: true }))
      .body.period;

    expect(second.isCurrent).toBe(true);
    const rows = await prisma.academicPeriod.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.filter((r) => r.isCurrent).map((r) => r.id)).toEqual([second.id]);
    expect(rows.find((r) => r.id === first.id)?.isCurrent).toBe(false);
  });

  it('never ends with two current periods, even with simultaneous requests', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await createPeriod(agent);
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        createPeriod(agent, { ...periodInput, name: `P${i}`, isCurrent: true }),
      ),
    );
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(await prisma.academicPeriod.count({ where: { isCurrent: true } })).toBe(1);
  });

  it('current periods of different users do not interfere', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await createPeriod(a.agent);
    await createPeriod(b.agent);
    expect(await prisma.academicPeriod.count({ where: { isCurrent: true } })).toBe(2);
  });
});

describe('GET /api/periods and /api/periods/:id', () => {
  it('lists only the own periods, newest first', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await createPeriod(a.agent, {
      ...periodInput,
      name: 'A-2026',
      startDate: '2026-02-01',
      endDate: '2026-06-01',
    });
    await createPeriod(a.agent, { ...periodInput, name: 'A-2026-2' });
    await createPeriod(b.agent, { ...periodInput, name: 'B-only' });

    const res = await a.agent.get('/api/periods');
    expect(res.status).toBe(200);
    expect(res.body.periods.map((p: { name: string }) => p.name)).toEqual(['A-2026-2', 'A-2026']);
  });

  it('returns an own period', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await createPeriod(agent)).body.period;
    const res = await agent.get(`/api/periods/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.period.id).toBe(id);
  });

  it('answers 404 for a malformed id exactly like for an unknown one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const bad = await agent.get('/api/periods/not-a-uuid');
    const unknown = await agent.get(`/api/periods/${randomUUID()}`);
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual(unknown.body);
  });
});

describe('PATCH /api/periods/:id', () => {
  it('updates name and dates', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await createPeriod(agent)).body.period;
    const res = await agent
      .patch(`/api/periods/${id}`)
      .send({ name: 'Renombrado', endDate: '2026-12-15' });
    expect(res.status).toBe(200);
    expect(res.body.period).toMatchObject({
      name: 'Renombrado',
      startDate: '2026-08-03',
      endDate: '2026-12-15',
    });
  });

  it('checks a lone endDate against the stored startDate', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await createPeriod(agent)).body.period;
    const res = await agent.patch(`/api/periods/${id}`).send({ endDate: '2026-08-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.endDate).toBeDefined();
    expect((await agent.get(`/api/periods/${id}`)).body.period.endDate).toBe('2026-11-28');
  });

  it('marking as current flips the previous current period; false is refused', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const first = (await createPeriod(agent)).body.period;
    const second = (await createPeriod(agent, { ...periodInput, name: 'Otro' })).body.period;

    const res = await agent.patch(`/api/periods/${second.id}`).send({ isCurrent: true });
    expect(res.status).toBe(200);
    expect(res.body.period.isCurrent).toBe(true);
    expect((await agent.get(`/api/periods/${first.id}`)).body.period.isCurrent).toBe(false);

    const refuse = await agent.patch(`/api/periods/${second.id}`).send({ isCurrent: false });
    expect(refuse.status).toBe(400);
  });
});

describe('database guarantees (independent of the API)', () => {
  it('rejects a second current period for the same user', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    await createPeriod(agent);
    await expect(
      prisma.academicPeriod.create({
        data: {
          userId: user.id,
          name: 'raw',
          startDate: new Date('2027-01-01'),
          endDate: new Date('2027-05-01'),
          isCurrent: true,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects endDate <= startDate', async () => {
    const { user } = await signUp(app, 'a@example.com');
    await expect(
      prisma.academicPeriod.create({
        data: {
          userId: user.id,
          name: 'raw',
          startDate: new Date('2027-05-01'),
          endDate: new Date('2027-01-01'),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('DELETE /api/periods/:id', () => {
  it('deletes an empty own period', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await createPeriod(agent)).body.period;
    expect((await agent.delete(`/api/periods/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/periods/${id}`)).status).toBe(404);
  });

  it('refuses with 409 PERIOD_NOT_EMPTY while it has subjects, and deletes nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const period = (await createPeriod(agent)).body.period;
    const subject = (await agent.post('/api/subjects').send({ periodId: period.id, name: 'Redes' }))
      .body.subject;

    const res = await agent.delete(`/api/periods/${period.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_NOT_EMPTY');
    expect(await prisma.academicPeriod.count()).toBe(1);
    expect(await prisma.subject.count()).toBe(1);

    await agent.delete(`/api/subjects/${subject.id}`).expect(204);
    await agent.delete(`/api/periods/${period.id}`).expect(204);
  });

  it('the foreign key itself refuses to drop a period that still has subjects', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const period = (await createPeriod(agent)).body.period;
    await agent.post('/api/subjects').send({ periodId: period.id, name: 'Redes' }).expect(201);
    await expect(prisma.academicPeriod.delete({ where: { id: period.id } })).rejects.toThrow();
  });

  it('deleting a user still removes their periods and subjects (no orphans)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const period = (await createPeriod(agent)).body.period;
    await agent.post('/api/subjects').send({ periodId: period.id, name: 'Redes' }).expect(201);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.academicPeriod.count()).toBe(0);
    expect(await prisma.subject.count()).toBe(0);
  });
});
