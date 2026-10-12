import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

const app = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const create = (agent: request.Agent, body: object = {}) =>
  agent.post('/api/periods').send({ ...periodInput, ...body });
const patch = (agent: request.Agent, id: string, body: unknown) =>
  agent.patch(`/api/periods/${id}`).send(body as object);
const level = (p: { studyLevel: number | null; studyLevelNote: string | null }) => [
  p.studyLevel,
  p.studyLevelNote,
];
const rowOf = (id: string) => prisma.academicPeriod.findUniqueOrThrow({ where: { id } });

describe('creating a period', () => {
  it('without a level (the current onboarding): both fields come back null', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await create(agent);
    expect(res.status).toBe(201);
    expect(res.body.period).toMatchObject({
      ...periodInput,
      studyLevel: null,
      studyLevelNote: null,
    });
    expect(level(await rowOf(res.body.period.id))).toEqual([null, null]);
  });

  it('with a numeric level, or a custom note, or explicit nulls', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const numeric = await create(agent, { studyLevel: 4 });
    const custom = await create(agent, { name: 'Otro', studyLevelNote: '  Internado  ' });
    const nulls = await create(agent, { name: 'Nulos', studyLevel: null, studyLevelNote: null });
    expect([numeric.status, custom.status, nulls.status]).toEqual([201, 201, 201]);
    expect(level(numeric.body.period)).toEqual([4, null]);
    expect(level(custom.body.period)).toEqual([null, 'Internado']);
    expect(level(nulls.body.period)).toEqual([null, null]);
    expect(level(await rowOf(custom.body.period.id))).toEqual([null, 'Internado']);
  });

  it('accepts more than ten levels: the domain does not know what kind of student this is', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    for (const studyLevel of [10, 11, 12, 99]) {
      expect((await create(agent, { name: `N${studyLevel}`, studyLevel })).status).toBe(201);
    }
  });

  it('does not look at the profile: the same number is valid for any primary use', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    for (const primaryUse of ['UNIVERSITY_STUDENT', 'SCHOOL_STUDENT', 'TEACHER', 'PERSONAL']) {
      await agent.patch('/api/profile').send({ primaryUse }).expect(200);
      const res = await create(agent, { name: primaryUse, studyLevel: 57 });
      expect(res.status, primaryUse).toBe(201);
    }
  });

  it('refuses invalid levels and notes and creates nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const bad = [
      { studyLevel: 0 },
      { studyLevel: -1 },
      { studyLevel: 100 },
      { studyLevel: 1e12 },
      { studyLevel: 4.5 },
      { studyLevel: '4' },
      { studyLevel: true },
      { studyLevelNote: 'x'.repeat(41) },
      { studyLevelNote: 'Inter\u0000nado' },
      { studyLevelNote: 4 },
      { studyLevel: 4, studyLevelNote: 'Cuarto' }, // both
      { semester: 4 },
      { grade: 10 },
      { userId: randomUUID() },
    ];
    for (const body of bad) {
      const res = await create(agent, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.academicPeriod.count()).toBe(0);
  });

  it('a blank note is stored as nothing, never as an empty string', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await create(agent, { studyLevelNote: '   ' });
    expect(res.status).toBe(201);
    expect((await rowOf(res.body.period.id)).studyLevelNote).toBeNull();
  });

  it('does not change how the current period is chosen', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const first = await create(agent, { studyLevel: 3 });
    const second = await create(agent, { name: 'Segundo', studyLevel: 4 });
    expect([first.body.period.isCurrent, second.body.period.isCurrent]).toEqual([true, false]);
    const third = await create(agent, { name: 'Tercero', studyLevel: 5, isCurrent: true });
    expect(third.body.period.isCurrent).toBe(true);
    expect((await rowOf(first.body.period.id)).isCurrent).toBe(false);
    expect(await prisma.academicPeriod.count({ where: { isCurrent: true } })).toBe(1);
  });
});

describe('updating the level of a period', () => {
  it('numeric -> custom -> clear, sending ONE field each time', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await create(agent)).body.period;

    const a = await patch(agent, id, { studyLevel: 4 });
    expect(a.status).toBe(200);
    expect(level(a.body.period)).toEqual([4, null]);

    const b = await patch(agent, id, { studyLevelNote: 'Internado' });
    expect(level(b.body.period)).toEqual([null, 'Internado']);
    expect(level(await rowOf(id))).toEqual([null, 'Internado']);

    const c = await patch(agent, id, { studyLevelNote: null });
    expect(level(c.body.period)).toEqual([null, null]);
  });

  it('custom -> numeric, change a number, and clear a number', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await create(agent, { studyLevelNote: 'Internado' })).body.period;
    expect(level((await patch(agent, id, { studyLevel: 7 })).body.period)).toEqual([7, null]);
    expect(level((await patch(agent, id, { studyLevel: 8 })).body.period)).toEqual([8, null]);
    expect(level((await patch(agent, id, { studyLevel: null })).body.period)).toEqual([null, null]);
  });

  it('an explicit pair is honoured; a blank note clears; not mentioning the level leaves it', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await create(agent, { studyLevel: 4 })).body.period;
    expect(level((await patch(agent, id, { name: 'Renombrado' })).body.period)).toEqual([4, null]);
    expect(
      level((await patch(agent, id, { studyLevel: null, studyLevelNote: 'Otro' })).body.period),
    ).toEqual([null, 'Otro']);
    expect(level((await patch(agent, id, { studyLevelNote: '   ' })).body.period)).toEqual([
      null,
      null,
    ]);
  });

  it('refuses both at once, bad values and unknown fields, and changes nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { id } = (await create(agent, { studyLevel: 4 })).body.period;
    for (const body of [
      { studyLevel: 5, studyLevelNote: 'Quinto' },
      { studyLevel: 0 },
      { studyLevel: -3 },
      { studyLevel: 100 },
      { studyLevel: 2.5 },
      { studyLevel: '5' },
      { studyLevelNote: 'x'.repeat(41) },
      { studyLevelNote: 'a\u0000b' },
      { semester: 5 },
      { userId: randomUUID() },
    ]) {
      const res = await patch(agent, id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(level(await rowOf(id))).toEqual([4, null]);
  });

  it('keeps the date rules, the current-period rules and the owner untouched', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const first = (await create(agent)).body.period;
    const second = (await create(agent, { name: 'Segundo' })).body.period;
    const res = await patch(agent, second.id, { studyLevel: 5, isCurrent: true });
    expect(res.status).toBe(200);
    expect(res.body.period).toMatchObject({ isCurrent: true, studyLevel: 5 });
    expect((await rowOf(first.id)).isCurrent).toBe(false);
    expect((await rowOf(second.id)).userId).toBe(user.id);
    // a lone endDate is still checked against the stored start
    expect((await patch(agent, second.id, { endDate: '2026-08-01', studyLevel: 6 })).status).toBe(
      400,
    );
    expect((await rowOf(second.id)).studyLevel).toBe(5);
  });
});

describe('ownership', () => {
  it('another user’s period can neither be read nor changed, level included (the same 404)', async () => {
    const owner = await setupUser(app, 'owner@example.com');
    const other = await signUp(app, 'other@example.com');
    const before = JSON.stringify(await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }));
    for (const body of [{ studyLevel: 9 }, { studyLevelNote: 'Robado' }, { studyLevel: null }]) {
      const res = await patch(other.agent, owner.period.id, body);
      expect(res.status, JSON.stringify(body)).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect(JSON.stringify(await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }))).toBe(
      before,
    );
    expect((await other.agent.get(`/api/periods/${owner.period.id}`)).status).toBe(404);
  });

  it('the level never reaches the list of someone else', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await create(a.agent, { studyLevel: 6 });
    expect((await b.agent.get('/api/periods')).body.periods).toEqual([]);
  });
});

describe('periods that already existed', () => {
  it('a row written without the new columns answers null in every place the period appears', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const old = await prisma.academicPeriod.create({
      data: {
        userId: user.id,
        name: 'Antiguo',
        startDate: new Date('2026-08-03T00:00:00.000Z'),
        endDate: new Date('2026-11-28T00:00:00.000Z'),
        isCurrent: true,
      },
    });
    expect(level(old)).toEqual([null, null]);
    const got = await agent.get(`/api/periods/${old.id}`);
    expect(level(got.body.period)).toEqual([null, null]);
    const list = await agent.get('/api/periods');
    expect(list.body.periods.map(level)).toEqual([[null, null]]);
    // the period that other answers carry has the same shape
    expect(level((await agent.get('/api/dashboard')).body.dashboard.period)).toEqual([null, null]);
    expect(level((await agent.get('/api/progress')).body.progress.period)).toEqual([null, null]);
  });
});

describe('database guarantees (independent of the API)', () => {
  const insert = async (sets: string) => {
    const { user } = await signUp(app, `db${Math.random()}@example.com`);
    return prisma.$executeRawUnsafe(
      `INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "updatedAt", ${sets.split('=')[0]!.trim()})
       VALUES (gen_random_uuid(), '${user.id}', 'P', '2026-08-03', '2026-11-28', now(), ${sets.split('=')[1]!.trim()})`,
    );
  };

  it('refuses a level out of range, an empty or long note, and both at once', async () => {
    await expect(insert(`"studyLevel" = 0`)).rejects.toThrow(/studyLevel_range/);
    await expect(insert(`"studyLevel" = 100`)).rejects.toThrow(/studyLevel_range/);
    await expect(insert(`"studyLevelNote" = ''`)).rejects.toThrow(/studyLevelNote_length/);
    await expect(insert(`"studyLevelNote" = '${'x'.repeat(41)}'`)).rejects.toThrow(
      /studyLevelNote_length/,
    );
    const { user } = await signUp(app, 'both@example.com');
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "updatedAt", "studyLevel", "studyLevelNote")
         VALUES (gen_random_uuid(), '${user.id}', 'P', '2026-08-03', '2026-11-28', now(), 4, 'Cuarto')`,
      ),
    ).rejects.toThrow(/studyLevel_exclusive/);
    expect(await prisma.academicPeriod.count()).toBe(0);
  });

  it('accepts the two valid shapes', async () => {
    await insert(`"studyLevel" = 99`);
    await insert(`"studyLevelNote" = 'Internado'`);
    expect(await prisma.academicPeriod.count()).toBe(2);
  });
});
