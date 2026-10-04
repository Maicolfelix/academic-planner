import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { scheduleListResponseSchema, scheduleWriteResponseSchema } from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { buildApp, periodInput, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

// "Now" is Wednesday 7 October 2026, 12:00 in Bogotá: inside the default test period (3 Aug – 28 Nov).
let now = new Date('2026-10-07T17:00:00.000Z');
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = new Date('2026-10-07T17:00:00.000Z');
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const CONFLICT_MESSAGE = 'Ya tienes otra actividad programada en este horario.';

type Body = Record<string, unknown>;
const study = (over: Body = {}): Body => ({
  type: 'STUDY',
  title: 'Estudio',
  date: '2026-10-07',
  startTime: '14:00',
  endTime: '15:00',
  ...over,
});
const weekly = (until = '2026-11-24'): Body => ({ recurrence: { frequency: 'WEEKLY', until } });
/** Redes: Tuesdays 08:00–10:00 from 4 August (the first Tuesday of the period) to 24 November. */
const redesBody = (subjectId: string, over: Body = {}): Body => ({
  type: 'CLASS',
  subjectId,
  title: 'Redes',
  date: '2026-08-04',
  startTime: '08:00',
  endTime: '10:00',
  ...weekly(),
  ...over,
});

const post = (agent: request.Agent, body: Body, query = '') =>
  agent.post(`/api/schedule${query}`).send(body);
const week = (agent: request.Agent, from: string, to: string) =>
  agent.get(`/api/schedule?from=${from}&to=${to}`);
const titles = (res: request.Response) =>
  res.body.occurrences.map((o: { title: string }) => o.title);
const dates = (res: request.Response) =>
  res.body.occurrences.map((o: { occurrenceDate: string }) => o.occurrenceDate);

describe('authentication', () => {
  it('every schedule endpoint requires a session', async () => {
    const id = randomUUID();
    const calls = [
      request(app).get('/api/schedule'),
      request(app).post('/api/schedule').send(study()),
      request(app).get(`/api/schedule/${id}`),
      request(app).patch(`/api/schedule/${id}`).send({ title: 'x' }),
      request(app).delete(`/api/schedule/${id}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('POST /api/schedule — creation', () => {
  it('creates a single block owned by the session user, in the current period, with no warnings', async () => {
    const { agent, user, period } = await setupUser(app, 'a@example.com');
    const res = await post(agent, study());

    expect(res.status).toBe(201);
    const { block, warnings } = scheduleWriteResponseSchema.parse(res.body);
    expect(warnings).toEqual([]);
    expect(block).toMatchObject({
      periodId: period.id,
      subjectId: null,
      subject: null,
      title: 'Estudio',
      type: 'STUDY',
      date: '2026-10-07',
      startTime: '14:00',
      endTime: '15:00',
      recurrence: null,
    });

    const row = await prisma.scheduleBlock.findUniqueOrThrow({ where: { id: block!.id } });
    expect(row).toMatchObject({
      userId: user.id,
      periodId: period.id,
      recurrenceType: 'NONE',
      recurrenceUntil: null,
    });
    expect(row.startAt.toISOString()).toBe('2026-10-07T19:00:00.000Z'); // 14:00 Bogotá (UTC-5)
    expect(row.endAt.toISOString()).toBe('2026-10-07T20:00:00.000Z');
  });

  it('creates ONE row for a weekly series, not one per week', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const res = await post(agent, redesBody(subject.id));

    expect(res.status).toBe(201);
    expect(res.body.block).toMatchObject({
      type: 'CLASS',
      subject: { id: subject.id, name: 'Redes' },
      date: '2026-08-04',
      recurrence: { frequency: 'WEEKLY', weekday: 2, until: '2026-11-24' },
    });
    expect(await prisma.scheduleBlock.count()).toBe(1);
    const row = await prisma.scheduleBlock.findFirstOrThrow();
    expect(row.recurrenceType).toBe('WEEKLY');
    expect(row.startAt.toISOString()).toBe('2026-08-04T13:00:00.000Z');
    expect(row.recurrenceUntil?.toISOString().slice(0, 10)).toBe('2026-11-24'); // a DATE: no timezone drift
  });

  it('reads the date and times in the USER’s timezone, not the server’s', async () => {
    const { agent, user } = await setupUser(app, 'nz@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Pacific/Auckland' } });
    const res = await post(
      agent,
      study({ date: '2026-10-07', startTime: '08:00', endTime: '09:30' }),
    );
    expect(res.body.block).toMatchObject({
      date: '2026-10-07',
      startTime: '08:00',
      endTime: '09:30',
    });
    // 08:00 at UTC+13 is 19:00 UTC the day before.
    expect(res.body.block.startAt).toBe('2026-10-06T19:00:00.000Z');
  });

  it('accepts all three types; only CLASS needs a subject', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    expect((await post(agent, study({ type: 'ACADEMIC_PERSONAL', title: 'Reunión' }))).status).toBe(
      201,
    );
    expect(
      (
        await post(
          agent,
          study({ type: 'STUDY', subjectId: subject.id, startTime: '16:00', endTime: '17:00' }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          agent,
          study({ type: 'CLASS', subjectId: subject.id, startTime: '18:00', endTime: '19:00' }),
        )
      ).status,
    ).toBe(201);
  });

  it.each([
    ['end before start', { startTime: '10:00', endTime: '08:00' }, 'endTime'],
    ['zero duration', { startTime: '08:00', endTime: '08:00' }, 'endTime'],
    ['malformed time', { startTime: '8:00' }, 'startTime'],
    ['empty title', { title: '  ' }, 'title'],
    ['title over 100 chars', { title: 'x'.repeat(101) }, 'title'],
    ['unknown type', { type: 'PARTY' }, 'type'],
    ['impossible date', { date: '2026-02-30' }, 'date'],
    ['missing date', { date: undefined }, 'date'],
    ['repeat ending before the first day', weekly('2026-10-01'), 'recurrence'],
    [
      'unknown frequency',
      { recurrence: { frequency: 'DAILY', until: '2026-11-01' } },
      'recurrence',
    ],
  ])('rejects %s with VALIDATION_ERROR and field details', async (_l, patch, field) => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await post(agent, study(patch));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[field]).toBeDefined();
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('rejects a body with userId or internal fields', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const { user: other } = await signUp(app, 'b@example.com');
    for (const extra of [
      { userId: other.id },
      { startAt: '2026-10-07T19:00:00.000Z' },
      { recurrenceType: 'WEEKLY' },
      { id: randomUUID() },
    ]) {
      expect((await post(agent, study(extra))).status).toBe(400);
    }
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('a CLASS must have a subject', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await post(agent, study({ type: 'CLASS' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.subjectId).toBeDefined();
  });

  it('keeps the block inside its period (date and repeat end)', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const before = await post(agent, study({ date: '2026-07-20' }));
    expect(before.status).toBe(400);
    expect(before.body.error.details.fields.date[0]).toContain('03/08/2026 – 28/11/2026');
    expect((await post(agent, study({ date: '2026-12-01' }))).status).toBe(400);
    const longRepeat = await post(agent, study(weekly('2027-03-30')));
    expect(longRepeat.status).toBe(400);
    expect(longRepeat.body.error.details.fields.recurrence).toBeDefined();
    // The very first and last days of the period are allowed.
    expect(
      (await post(agent, study({ date: '2026-08-03', startTime: '06:00', endTime: '07:00' })))
        .status,
    ).toBe(201);
    expect(
      (await post(agent, study({ date: '2026-11-28', startTime: '06:00', endTime: '07:00' })))
        .status,
    ).toBe(201);
  });

  it('a user without a current period gets a clear error, not a crash', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await post(agent, study());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
  });

  describe('subject and period must be the user’s own, and consistent', () => {
    it('unknown subject -> 404', async () => {
      const { agent } = await setupUser(app, 'a@example.com');
      const res = await post(agent, study({ subjectId: randomUUID() }));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('a subject of the same user but ANOTHER period -> 400 (it is theirs, so nothing leaks)', async () => {
      const { agent } = await setupUser(app, 'a@example.com');
      const other = (
        await agent
          .post('/api/periods')
          .send({ ...periodInput, name: 'Otro', startDate: '2027-02-01', endDate: '2027-06-01' })
      ).body.period;
      const otherSubject = (
        await agent.post('/api/subjects').send({ periodId: other.id, name: 'Vieja' })
      ).body.subject;
      const res = await post(agent, study({ subjectId: otherSubject.id }));
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields.subjectId[0]).toContain('mismo periodo');
      // …and it works once the block is placed in that subject's own period.
      const ok = await post(
        agent,
        study({ subjectId: otherSubject.id, periodId: other.id, date: '2027-03-03' }),
      );
      expect(ok.status).toBe(201);
      expect(ok.body.block.periodId).toBe(other.id);
    });

    it('an explicit periodId of the user works; unknown or foreign ones answer the same 404', async () => {
      const a = await setupUser(app, 'a@example.com');
      const b = await setupUser(app, 'b@example.com');
      expect((await post(a.agent, study({ periodId: a.period.id }))).status).toBe(201);

      const foreign = await post(a.agent, study({ periodId: b.period.id }));
      const ghost = await post(a.agent, study({ periodId: randomUUID() }));
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(ghost.body);
    });
  });

  it('the database itself refuses impossible blocks, whoever writes them', async () => {
    const { user, period } = await setupUser(app, 'a@example.com');
    const base = {
      userId: user.id,
      periodId: period.id,
      title: 'raw',
      type: 'STUDY' as const,
      startAt: new Date('2026-10-07T14:00:00Z'),
      endAt: new Date('2026-10-07T15:00:00Z'),
    };
    await expect(
      prisma.scheduleBlock.create({ data: { ...base, endAt: base.startAt } }),
    ).rejects.toThrow(); // zero length
    await expect(
      prisma.scheduleBlock.create({ data: { ...base, endAt: new Date('2026-10-07T13:00:00Z') } }),
    ).rejects.toThrow(); // negative
    await expect(
      prisma.scheduleBlock.create({ data: { ...base, endAt: new Date('2026-10-08T14:00:01Z') } }),
    ).rejects.toThrow(); // > 24 h
    await expect(
      prisma.scheduleBlock.create({ data: { ...base, recurrenceType: 'WEEKLY' } }),
    ).rejects.toThrow(); // series without end
    await expect(
      prisma.scheduleBlock.create({ data: { ...base, recurrenceUntil: new Date('2026-11-01') } }),
    ).rejects.toThrow(); // single with end
    // Exactly 24 hours is the longest allowed.
    await expect(
      prisma.scheduleBlock.create({ data: { ...base, endAt: new Date('2026-10-08T14:00:00Z') } }),
    ).resolves.toBeTruthy();
  });
});

describe('GET /api/schedule — weekly query expands only the requested range', () => {
  it('a weekly series shows only on its weekday of the requested week', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await post(agent, redesBody(subject.id)).expect(201);

    const res = await week(agent, '2026-10-05', '2026-10-11');
    expect(res.status).toBe(200);
    const parsed = scheduleListResponseSchema.parse(res.body);
    expect(parsed.range).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(parsed.occurrences).toHaveLength(1); // one week, not the 17 of the semester
    expect(parsed.occurrences[0]).toMatchObject({
      occurrenceDate: '2026-10-06',
      startAt: '2026-10-06T13:00:00.000Z',
      endAt: '2026-10-06T15:00:00.000Z',
      title: 'Redes',
      type: 'CLASS',
      isRecurring: true,
      hasConflict: false,
      subject: { name: 'Redes' },
    });

    expect(dates(await week(agent, '2026-10-12', '2026-10-18'))).toEqual(['2026-10-13']);
  });

  it('returns nothing for a week outside the series (before its first day, after its last)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await post(agent, redesBody(subject.id)).expect(201);
    expect((await week(agent, '2026-07-27', '2026-08-02')).body.occurrences).toEqual([]);
    expect((await week(agent, '2026-11-30', '2026-12-06')).body.occurrences).toEqual([]);
    expect(dates(await week(agent, '2026-08-03', '2026-08-09'))).toEqual(['2026-08-04']); // first day
    expect(dates(await week(agent, '2026-11-23', '2026-11-29'))).toEqual(['2026-11-24']); // `until`, inclusive
  });

  it('a single block appears only in the week of its date; blocks are ordered by start time', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await post(
      agent,
      study({ title: 'Tarde', date: '2026-10-07', startTime: '16:00', endTime: '17:00' }),
    ).expect(201);
    await post(
      agent,
      study({ title: 'Mañana', date: '2026-10-07', startTime: '08:00', endTime: '09:00' }),
    ).expect(201);
    await post(
      agent,
      study({ title: 'Lunes', date: '2026-10-05', startTime: '12:00', endTime: '13:00' }),
    ).expect(201);
    await post(agent, study({ title: 'Próxima semana', date: '2026-10-14' })).expect(201);

    expect(titles(await week(agent, '2026-10-05', '2026-10-11'))).toEqual([
      'Lunes',
      'Mañana',
      'Tarde',
    ]);
    expect(titles(await week(agent, '2026-10-12', '2026-10-18'))).toEqual(['Próxima semana']);
    expect((await week(agent, '2026-10-19', '2026-10-25')).body.occurrences).toEqual([]);
  });

  it('works on Monday and Sunday, the edges of the week', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await post(
      agent,
      study({ title: 'Lunes 00:00', date: '2026-10-05', startTime: '00:00', endTime: '01:00' }),
    ).expect(201);
    await post(
      agent,
      study({ title: 'Domingo 23:59', date: '2026-10-11', startTime: '22:00', endTime: '23:59' }),
    ).expect(201);
    expect(titles(await week(agent, '2026-10-05', '2026-10-11'))).toEqual([
      'Lunes 00:00',
      'Domingo 23:59',
    ]);
    expect(titles(await week(agent, '2026-10-12', '2026-10-18'))).toEqual([]);
    expect(titles(await week(agent, '2026-09-28', '2026-10-04'))).toEqual([]);
  });

  it('defaults to the current Monday–Sunday week of the user when no range is given', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await post(agent, study({ title: 'Esta semana', date: '2026-10-08' })).expect(201);
    await post(agent, study({ title: 'Otra semana', date: '2026-10-15' })).expect(201);
    const res = await agent.get('/api/schedule');
    expect(res.body.range).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(titles(res)).toEqual(['Esta semana']);
  });

  it('the default week is the USER’s week: Sunday night in Bogotá is still the old week', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    now = new Date('2026-10-12T04:30:00.000Z'); // Sunday 23:30 in Bogotá (already Monday in UTC)
    expect((await agent.get('/api/schedule')).body.range).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
    });
    now = new Date('2026-10-12T05:30:00.000Z'); // Monday 00:30 in Bogotá
    expect((await agent.get('/api/schedule')).body.range).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
  });

  it.each([
    ['only one bound', '?from=2026-10-05'],
    ['from after to', '?from=2026-10-11&to=2026-10-05'],
    ['invalid date', '?from=2026-13-01&to=2026-13-02'],
    ['a range over 42 days', '?from=2026-10-01&to=2026-11-12'],
  ])('rejects %s', async (_l, qs) => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await agent.get(`/api/schedule${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('flags overlapping occurrences and leaves touching ones alone', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    await post(agent, study({ title: 'A', startTime: '08:00', endTime: '10:00' })).expect(201);
    await post(agent, study({ title: 'B', startTime: '09:00', endTime: '11:00' })).expect(201);
    await post(agent, study({ title: 'C', startTime: '11:00', endTime: '12:00' })).expect(201); // touches B
    const flags = Object.fromEntries(
      (await week(agent, '2026-10-05', '2026-10-11')).body.occurrences.map(
        (o: { title: string; hasConflict: boolean }) => [o.title, o.hasConflict],
      ),
    );
    expect(flags).toEqual({ A: true, B: true, C: false });
  });

  it('never includes another user’s blocks', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await post(a.agent, study({ title: 'de A' })).expect(201);
    await post(b.agent, study({ title: 'de B' })).expect(201);
    expect(titles(await week(a.agent, '2026-10-05', '2026-10-11'))).toEqual(['de A']);
    expect(titles(await week(b.agent, '2026-10-05', '2026-10-11'))).toEqual(['de B']);
  });

  it('a user in another timezone sees the same wall-clock time every week, across a daylight-saving change', async () => {
    const { agent, user } = await setupUser(app, 'ny@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'America/New_York' } });
    // A New York period covering the spring-forward week (8 March 2026).
    const ny = (
      await agent
        .post('/api/periods')
        .send({ name: 'NY', startDate: '2026-01-05', endDate: '2026-06-26', isCurrent: true })
    ).body.period;
    const subject = (await agent.post('/api/subjects').send({ periodId: ny.id, name: 'Física' }))
      .body.subject;
    await post(agent, {
      type: 'CLASS',
      subjectId: subject.id,
      title: 'Física',
      date: '2026-01-06', // a Tuesday
      startTime: '08:00',
      endTime: '09:00',
      ...weekly('2026-06-23'),
    }).expect(201);

    const before = (await week(agent, '2026-03-02', '2026-03-08')).body.occurrences[0];
    const after = (await week(agent, '2026-03-09', '2026-03-15')).body.occurrences[0];
    expect(before).toMatchObject({
      occurrenceDate: '2026-03-03',
      startAt: '2026-03-03T13:00:00.000Z',
    }); // EST, UTC-5
    expect(after).toMatchObject({
      occurrenceDate: '2026-03-10',
      startAt: '2026-03-10T12:00:00.000Z',
    }); // EDT, UTC-4
    // Both are 08:00 on the user's wall clock; the UTC instant moved by an hour, as it must.
  });
});

describe('GET /api/schedule/:id', () => {
  it('returns the block; a malformed id is 404 like an unknown one', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, study())).body.block;
    expect((await agent.get(`/api/schedule/${id}`)).body.block.title).toBe('Estudio');
    const bad = await agent.get('/api/schedule/not-a-uuid');
    const unknown = await agent.get(`/api/schedule/${randomUUID()}`);
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual(unknown.body);
  });
});

describe('conflicts are warnings, never blocking', () => {
  it('a weekly class that clashes with another weekly class warns and is still saved', async () => {
    const { agent, subject, period } = await setupUser(app, 'a@example.com');
    const bases = (
      await agent.post('/api/subjects').send({ periodId: period.id, name: 'Bases de Datos' })
    ).body.subject;
    const redes = (await post(agent, redesBody(subject.id))).body.block;
    const res = await post(
      agent,
      redesBody(bases.id, { title: 'Bases de Datos', startTime: '09:00', endTime: '11:00' }),
    );

    expect(res.status).toBe(201); // saved anyway
    const { block, warnings } = scheduleWriteResponseSchema.parse(res.body);
    expect(block).not.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'SCHEDULE_CONFLICT',
      message: CONFLICT_MESSAGE,
      with: { blockId: redes.id, title: 'Redes', type: 'CLASS', occurrences: 17 }, // every Tuesday of the semester
    });
    // `with` describes the EXISTING block's first clashing occurrence: Redes, 08:00–10:00 Bogotá.
    expect(warnings[0]!.with.startAt).toBe('2026-08-04T13:00:00.000Z');
    expect(warnings[0]!.with.endAt).toBe('2026-08-04T15:00:00.000Z');
    expect(await prisma.scheduleBlock.count()).toBe(2);
  });

  it('dryRun reports the same warnings WITHOUT saving anything', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await post(agent, redesBody(subject.id)).expect(201);
    const before = await prisma.scheduleBlock.count();

    const res = await post(
      agent,
      redesBody(subject.id, { title: 'Otra', startTime: '09:00', endTime: '11:00' }),
      '?dryRun=true',
    );
    expect(res.status).toBe(200);
    expect(res.body.block).toBeNull();
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].message).toBe(CONFLICT_MESSAGE);
    expect(await prisma.scheduleBlock.count()).toBe(before);
  });

  it('a dry run still validates everything', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect(
      (await post(agent, study({ startTime: '10:00', endTime: '08:00' }), '?dryRun=true')).status,
    ).toBe(400);
    expect((await post(agent, study({ subjectId: randomUUID() }), '?dryRun=true')).status).toBe(
      404,
    );
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('touching hours (08–10 and 10–12) and different weekdays do not clash', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await post(agent, redesBody(subject.id)).expect(201);
    const touching = await post(
      agent,
      redesBody(subject.id, { title: 'Después', startTime: '10:00', endTime: '12:00' }),
    );
    const otherDay = await post(
      agent,
      redesBody(subject.id, {
        title: 'Miércoles',
        date: '2026-08-05',
        startTime: '08:00',
        endTime: '10:00',
        ...weekly('2026-11-25'),
      }),
    );
    expect(touching.body.warnings).toEqual([]);
    expect(otherDay.body.warnings).toEqual([]);
  });

  it('a single block that lands on one occurrence of a series clashes once, and the reverse too', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await post(agent, redesBody(subject.id)).expect(201);

    const meeting = await post(
      agent,
      study({ title: 'Reunión', date: '2026-10-13', startTime: '09:30', endTime: '10:30' }),
    ); // a Tuesday
    expect(meeting.body.warnings).toHaveLength(1);
    expect(meeting.body.warnings[0].with).toMatchObject({ title: 'Redes', occurrences: 1 });
    expect(
      (
        await post(
          agent,
          study({ title: 'Miércoles', date: '2026-10-14', startTime: '09:30', endTime: '10:30' }),
        )
      ).body.warnings,
    ).toEqual([]);

    // A new SERIES is checked against single blocks dated later in the semester, not only against its first day.
    await resetDb();
    const again = await setupUser(app, 'b@example.com');
    await post(
      again.agent,
      study({ title: 'Estudio martes', date: '2026-11-03', startTime: '08:30', endTime: '09:30' }),
    ).expect(201);
    const series = await post(again.agent, redesBody(again.subject.id));
    expect(series.body.warnings).toHaveLength(1);
    expect(series.body.warnings[0].with).toMatchObject({ title: 'Estudio martes', occurrences: 1 });
  });

  it('a series that ended before the new one starts does not clash', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await post(
      agent,
      redesBody(subject.id, { date: '2026-08-04', ...weekly('2026-09-01') }),
    ).expect(201);
    const later = await post(
      agent,
      redesBody(subject.id, { title: 'Después', date: '2026-09-15', ...weekly('2026-11-24') }),
    );
    expect(later.body.warnings).toEqual([]);
  });

  it('editing a block does not clash with itself, but does with others', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const a = (await post(agent, study({ title: 'A', startTime: '08:00', endTime: '10:00' }))).body
      .block;
    const b = (await post(agent, study({ title: 'B', startTime: '12:00', endTime: '13:00' }))).body
      .block;

    const rename = await agent.patch(`/api/schedule/${a.id}`).send({ title: 'A2' });
    expect(rename.body.warnings).toEqual([]);

    const move = await agent
      .patch(`/api/schedule/${b.id}`)
      .send({ startTime: '09:00', endTime: '11:00' });
    expect(move.status).toBe(200);
    expect(move.body.warnings).toHaveLength(1);
    expect(move.body.warnings[0].with.title).toBe('A2');
    expect(move.body.block.startTime).toBe('09:00'); // saved anyway
  });

  it('never clashes with another user’s blocks', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    await post(b.agent, study({ title: 'de B' })).expect(201);
    expect((await post(a.agent, study({ title: 'de A' }))).body.warnings).toEqual([]);
  });

  it('the conflict is judged on the wall clock across a daylight-saving change', async () => {
    const { agent, user } = await setupUser(app, 'ny@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'America/New_York' } });
    const ny = (
      await agent
        .post('/api/periods')
        .send({ name: 'NY', startDate: '2026-01-05', endDate: '2026-06-26', isCurrent: true })
    ).body.period;
    const subject = (await agent.post('/api/subjects').send({ periodId: ny.id, name: 'Física' }))
      .body.subject;
    const series = (over: Body) => ({
      type: 'CLASS',
      subjectId: subject.id,
      title: 'x',
      date: '2026-01-06',
      startTime: '08:00',
      endTime: '10:00',
      ...weekly('2026-06-23'),
      ...over,
    });
    await post(agent, series({ title: 'Física' })).expect(201);
    const res = await post(
      agent,
      series({ title: 'Química', startTime: '09:00', endTime: '11:00' }),
    );
    // Every Tuesday clashes, before and after the clock change: 25 of them from 6 Jan to 23 Jun.
    expect(res.body.warnings[0].with.occurrences).toBe(25);
  });
});

describe('PATCH /api/schedule/:id', () => {
  it('edits title, times, date and type of a single block', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, study())).body.block;
    const res = await agent.patch(`/api/schedule/${id}`).send({
      title: 'Repaso',
      startTime: '10:00',
      endTime: '11:30',
      date: '2026-10-08',
      type: 'STUDY',
      subjectId: subject.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.block).toMatchObject({
      title: 'Repaso',
      date: '2026-10-08',
      startTime: '10:00',
      endTime: '11:30',
      subjectId: subject.id,
    });
    const row = await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } });
    expect(row.startAt.toISOString()).toBe('2026-10-08T15:00:00.000Z');
  });

  it('editing a series changes ALL its weeks (and stays one row)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, redesBody(subject.id))).body.block;

    const res = await agent
      .patch(`/api/schedule/${id}`)
      .send({ startTime: '10:00', endTime: '12:00' });
    expect(res.body.block.recurrence).toMatchObject({
      frequency: 'WEEKLY',
      weekday: 2,
      until: '2026-11-24',
    });

    for (const [from, to] of [
      ['2026-08-03', '2026-08-09'],
      ['2026-10-05', '2026-10-11'],
      ['2026-11-23', '2026-11-29'],
    ] as const) {
      const occ = (await week(agent, from, to)).body.occurrences;
      expect(occ).toHaveLength(1);
      expect(occ[0].startAt.slice(11, 16)).toBe('15:00'); // 10:00 Bogotá, in every week
    }
    expect(await prisma.scheduleBlock.count()).toBe(1);
  });

  it('moving the date of a series moves its weekday (and keeps `until`)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, redesBody(subject.id))).body.block;
    const res = await agent.patch(`/api/schedule/${id}`).send({ date: '2026-08-05' }); // Wednesday
    expect(res.body.block.recurrence).toMatchObject({ weekday: 3, until: '2026-11-24' });
    expect(dates(await week(agent, '2026-10-05', '2026-10-11'))).toEqual(['2026-10-07']);
  });

  it('a series can become a single block (recurrence: null) and a single block a series', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, redesBody(subject.id))).body.block;

    const single = await agent
      .patch(`/api/schedule/${id}`)
      .send({ recurrence: null, date: '2026-10-06' });
    expect(single.body.block.recurrence).toBeNull();
    const row = await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ recurrenceType: 'NONE', recurrenceUntil: null });
    expect(dates(await week(agent, '2026-10-12', '2026-10-18'))).toEqual([]); // no more Tuesdays

    const series = await agent
      .patch(`/api/schedule/${id}`)
      .send({ recurrence: { frequency: 'WEEKLY', until: '2026-11-24' } });
    expect(series.body.block.recurrence).toMatchObject({ frequency: 'WEEKLY', weekday: 2 });
    expect(dates(await week(agent, '2026-10-12', '2026-10-18'))).toEqual(['2026-10-13']);
  });

  it('checks a lone time against the stored one', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, study({ startTime: '14:00', endTime: '15:00' }))).body.block;
    const res = await agent.patch(`/api/schedule/${id}`).send({ startTime: '16:00' }); // after the stored 15:00 end
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.endTime).toBeDefined();
    expect((await agent.get(`/api/schedule/${id}`)).body.block.startTime).toBe('14:00');
  });

  it('keeps the class/subject rule when editing', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const klass = (await post(agent, redesBody(subject.id))).body.block;
    expect((await agent.patch(`/api/schedule/${klass.id}`).send({ subjectId: null })).status).toBe(
      400,
    );

    const free = (await post(agent, study({ startTime: '18:00', endTime: '19:00' }))).body.block;
    expect((await agent.patch(`/api/schedule/${free.id}`).send({ type: 'CLASS' })).status).toBe(
      400,
    );
    expect(
      (await agent.patch(`/api/schedule/${free.id}`).send({ type: 'CLASS', subjectId: subject.id }))
        .status,
    ).toBe(200);
  });

  it('keeps the block inside the period when editing', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, redesBody(subject.id))).body.block;
    expect((await agent.patch(`/api/schedule/${id}`).send({ date: '2026-07-01' })).status).toBe(
      400,
    );
    expect(
      (
        await agent
          .patch(`/api/schedule/${id}`)
          .send({ recurrence: { frequency: 'WEEKLY', until: '2027-01-12' } })
      ).status,
    ).toBe(400);
    // Moving the first day beyond the end of the series is refused too.
    const late = await agent.patch(`/api/schedule/${id}`).send({ date: '2026-12-01' });
    expect(late.status).toBe(400);
  });

  it('refuses periodId, userId and other internal fields', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, study())).body.block;
    for (const body of [
      { periodId: randomUUID() },
      { userId: randomUUID() },
      { startAt: '2026-10-07T19:00:00Z' },
    ]) {
      expect((await agent.patch(`/api/schedule/${id}`).send(body)).status).toBe(400);
    }
  });

  it('a dry-run edit does not persist anything', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, study())).body.block;
    const res = await agent
      .patch(`/api/schedule/${id}?dryRun=true`)
      .send({ title: 'No debería guardarse' });
    expect(res.status).toBe(200);
    expect(res.body.block).toBeNull();
    expect((await agent.get(`/api/schedule/${id}`)).body.block.title).toBe('Estudio');
  });

  it('the subject must be the user’s own and from the block’s period', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    const { id } = (await post(a.agent, study())).body.block;

    const foreign = await a.agent.patch(`/api/schedule/${id}`).send({ subjectId: b.subject.id });
    const ghost = await a.agent.patch(`/api/schedule/${id}`).send({ subjectId: randomUUID() });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ghost.body);
    expect((await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } })).subjectId).toBeNull();
  });
});

describe('DELETE /api/schedule/:id', () => {
  it('deletes a single block', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, study())).body.block;
    expect((await agent.delete(`/api/schedule/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/schedule/${id}`)).status).toBe(404);
    expect((await agent.delete(`/api/schedule/${id}`)).status).toBe(404);
  });

  it('deleting a series removes every week at once', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, redesBody(subject.id))).body.block;
    expect(dates(await week(agent, '2026-10-05', '2026-10-11'))).toEqual(['2026-10-06']);

    expect((await agent.delete(`/api/schedule/${id}`)).status).toBe(204);
    for (const [from, to] of [
      ['2026-08-03', '2026-08-09'],
      ['2026-10-05', '2026-10-11'],
      ['2026-11-23', '2026-11-29'],
    ] as const) {
      expect((await week(agent, from, to)).body.occurrences).toEqual([]);
    }
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('deleting a user removes their blocks (no orphans)', async () => {
    const { agent, user } = await setupUser(app, 'a@example.com');
    await post(agent, study()).expect(201);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });
});

describe('deleting subjects and periods that schedule blocks depend on', () => {
  it('a subject with a block cannot be deleted (409), and nothing is lost', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await post(agent, redesBody(subject.id)).expect(201);
    const res = await agent.delete(`/api/subjects/${subject.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBJECT_NOT_EMPTY');
    expect(res.body.error.message).toBe(
      'La asignatura tiene actividades o bloques de agenda asociados.',
    );
    expect(res.body.error.details).toEqual({ activities: 0, scheduleBlocks: 1 });
    expect(await prisma.subject.count()).toBe(1);
    expect(await prisma.scheduleBlock.count()).toBe(1);
  });

  it('activities alone also block it, and both together report both counts', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    await agent
      .post('/api/activities')
      .send({ subjectId: subject.id, title: 'x', dueDate: '2099-01-01' })
      .expect(201);
    let res = await agent.delete(`/api/subjects/${subject.id}`);
    expect(res.body.error.details).toEqual({ activities: 1, scheduleBlocks: 0 });
    await post(agent, redesBody(subject.id)).expect(201);
    res = await agent.delete(`/api/subjects/${subject.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ activities: 1, scheduleBlocks: 1 });
  });

  it('it can be deleted once the block is gone', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, redesBody(subject.id))).body.block;
    expect((await agent.delete(`/api/subjects/${subject.id}`)).status).toBe(409);
    await agent.delete(`/api/schedule/${id}`).expect(204);
    expect((await agent.delete(`/api/subjects/${subject.id}`)).status).toBe(204);
  });

  it('the foreign key itself refuses to drop a subject or period that still has blocks', async () => {
    const { agent, subject, period } = await setupUser(app, 'a@example.com');
    await post(agent, redesBody(subject.id)).expect(201);
    await expect(prisma.subject.delete({ where: { id: subject.id } })).rejects.toThrow();
    await expect(prisma.academicPeriod.delete({ where: { id: period.id } })).rejects.toThrow();
  });

  it('a period with ONLY a standalone block (no subjects at all) cannot be deleted', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const period = (await agent.post('/api/periods').send(periodInput)).body.period;
    const block = (await post(agent, study())).body.block;

    const res = await agent.delete(`/api/periods/${period.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_NOT_EMPTY');
    expect(await prisma.academicPeriod.count()).toBe(1);

    await agent.delete(`/api/schedule/${block.id}`).expect(204);
    expect((await agent.delete(`/api/periods/${period.id}`)).status).toBe(204);
  });
});

describe('concurrency', () => {
  it('simultaneous overlapping creations all succeed: a conflict is a warning, not a constraint', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) =>
        post(agent, study({ title: `Simultáneo ${i}`, startTime: '09:00', endTime: '10:00' })),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    expect(await prisma.scheduleBlock.count()).toBe(6);

    // Not every response can know about its siblings (that race is accepted by design),
    // but the agenda flags all of them once they exist.
    const occ = (await week(agent, '2026-10-05', '2026-10-11')).body.occurrences;
    expect(occ).toHaveLength(6);
    expect(occ.every((o: { hasConflict: boolean }) => o.hasConflict)).toBe(true);
  });

  it('simultaneous edits of one block leave a valid row', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const { id } = (await post(agent, study())).body.block;
    const edits = [
      { startTime: '08:00', endTime: '09:00' },
      { startTime: '10:00', endTime: '11:00' },
      { title: 'Otro título' },
      { date: '2026-10-08', startTime: '12:00', endTime: '13:00' },
    ];
    const results = await Promise.all(edits.map((e) => agent.patch(`/api/schedule/${id}`).send(e)));
    for (const r of results) expect([200, 400]).toContain(r.status); // never a 500
    const row = await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } });
    expect(row.endAt.getTime()).toBeGreaterThan(row.startAt.getTime());
  });

  it('deleting a subject while blocks are being created never errors and never orphans', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'inicial');
    for (let round = 0; round < 6; round++) {
      const subject = (
        await agent.post('/api/subjects').send({ periodId: period.id, name: `Materia ${round}` })
      ).body.subject;
      const results = await Promise.all([
        agent.delete(`/api/subjects/${subject.id}`),
        post(
          agent,
          study({
            subjectId: subject.id,
            title: `a${round}`,
            startTime: '06:00',
            endTime: '07:00',
          }),
        ),
        post(
          agent,
          study({
            subjectId: subject.id,
            title: `b${round}`,
            startTime: '07:00',
            endTime: '08:00',
          }),
        ),
      ]);
      for (const r of results)
        expect([201, 204, 404, 409], `round ${round}: ${r.status}`).toContain(r.status);
      const stillThere = await prisma.subject.findUnique({ where: { id: subject.id } });
      const orphans = await prisma.scheduleBlock.count({ where: { subjectId: subject.id } });
      if (!stillThere) expect(orphans).toBe(0);
    }
  });
});

describe('efficiency: a weekly query on a semester with many series stays cheap', () => {
  const queries: string[] = [];
  const logged = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: 'event', level: 'query' }],
  });
  logged.$on('query', (e) => queries.push(e.query));
  const loggedApp = buildApp({ prisma: logged, clock: () => now });
  afterAll(() => logged.$disconnect());

  it('expands only the requested week and uses a constant number of queries', async () => {
    const { agent, user, period, subject } = await setupUser(loggedApp, 'perf@example.com');

    // 12 weekly series (Mon–Sat, several hours) + 60 single blocks spread over the semester.
    // `hour` is a Bogotá wall-clock hour (UTC-5): add 5 to get the UTC instant.
    const startAt = (date: string, hour: number) =>
      new Date(Date.parse(`${date}T00:00:00Z`) + (hour + 5) * 3_600_000);
    const series = Array.from({ length: 12 }, (_, i) => {
      const date = `2026-08-0${3 + (i % 6)}`; // Mon 3 Aug … Sat 8 Aug
      return {
        userId: user.id,
        periodId: period.id,
        subjectId: subject.id,
        title: `Serie ${i}`,
        type: 'CLASS' as const,
        startAt: startAt(date, 7 + (i % 3) * 3),
        endAt: startAt(date, 8 + (i % 3) * 3),
        recurrenceType: 'WEEKLY' as const,
        recurrenceUntil: new Date('2026-11-24'),
      };
    });
    const singles = Array.from({ length: 60 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 7, 3 + i * 2)); // every other day from 3 Aug
      const date = day.toISOString().slice(0, 10);
      return {
        userId: user.id,
        periodId: period.id,
        title: `Único ${i}`,
        type: 'STUDY' as const,
        startAt: startAt(date, 20),
        endAt: startAt(date, 21),
      };
    });
    await prisma.scheduleBlock.createMany({ data: [...series, ...singles] });

    queries.length = 0;
    const started = performance.now();
    const res = await week(agent, '2026-10-05', '2026-10-11');
    const ms = performance.now() - started;

    expect(res.status).toBe(200);
    const occ = res.body.occurrences as { occurrenceDate: string; blockId: string }[];
    expect(occ.length).toBeGreaterThanOrEqual(12); // every series appears once…
    expect(occ.length).toBeLessThanOrEqual(12 + 4); // …plus the few singles of that week: NOT hundreds
    expect(
      occ.every((o) => o.occurrenceDate >= '2026-10-05' && o.occurrenceDate <= '2026-10-11'),
    ).toBe(true);
    expect(queries.length).toBeLessThanOrEqual(3); // session (1) + candidate blocks (1) [+ lastUsedAt touch]
    console.info(
      `schedule week: ${occ.length} occurrences from 72 blocks, ${queries.length} queries, ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(1500); // generous: only guards against accidental disasters
  });
});
