import { PrismaPg } from '@prisma/adapter-pg';
import {
  ACADEMIC_INBOX_MAX_PROPOSALS,
  academicInboxResponseSchema,
  attentionResponseSchema,
  progressResponseSchema,
  radarResponseSchema,
  workloadResponseSchema,
  type AcademicInboxProposal,
  type AcademicInboxResponse,
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

const parse = async (agent: request.Agent, text: string): Promise<AcademicInboxResponse> => {
  const res = await agent.post('/api/academic-inbox/parse').send({ text });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return academicInboxResponseSchema.parse(res.body); // also validates the whole shape
};
const subjectOf = async (agent: request.Agent, periodId: string, name: string) =>
  (await agent.post('/api/subjects').send({ periodId, name })).body.subject as {
    id: string;
    name: string;
  };
const codes = (p: AcademicInboxProposal) => p.warnings.map((w) => w.code);

const MESSAGE =
  'Buenas tardes. El martes tendremos parcial de Redes a las 10am y el viernes deben entregar el taller 2.';

describe('POST /api/academic-inbox/parse — access and input', () => {
  it('requires a session', async () => {
    const res = await request(app).post('/api/academic-inbox/parse').send({ text: MESSAGE });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is never cached', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await agent.post('/api/academic-inbox/parse').send({ text: MESSAGE });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['no body', undefined],
    ['no text', {}],
    ['a number', { text: 5 }],
    ['null', { text: null }],
    ['an array', { text: ['parcial'] }],
    ['text over the hard cap', { text: 'x'.repeat(20_001) }],
    ['a userId', { text: MESSAGE, userId: '00000000-0000-4000-8000-000000000001' }],
    ['a periodId', { text: MESSAGE, periodId: '00000000-0000-4000-8000-000000000001' }],
    ['a subjects list', { text: MESSAGE, subjects: [{ id: 'x', name: 'Redes' }] }],
    ['any other key', { text: MESSAGE, now: '2030-01-01T00:00:00Z' }],
  ])('rejects %s with a validation error', async (_label, body) => {
    const { agent } = await setupUser(app, 'a@example.com');
    const call = agent.post('/api/academic-inbox/parse');
    const res = await (body === undefined ? call : call.send(body as object));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('an empty text is answered, not an error: status EMPTY', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    for (const text of ['', '   \n  ']) {
      const r = await parse(agent, text);
      expect(r.inbox.status).toBe('EMPTY');
      expect(r.inbox.proposals).toEqual([]);
    }
  });

  it('a text over 5000 characters is answered with TOO_LONG and nothing is interpreted', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const r = await parse(agent, `${MESSAGE} ${'x '.repeat(2600)}`);
    expect(r.inbox.status).toBe('TOO_LONG');
    expect(r.inbox.proposals).toEqual([]);
    expect(r.inbox.warnings[0]!.message).toBe(
      'El texto es demasiado largo. Pega únicamente el mensaje académico relevante.',
    );
    const ok = await parse(agent, MESSAGE.padEnd(5000, ' ') + 'x'.slice(0, 0));
    expect(ok.inbox.status).toBe('OK');
  });

  it('a message with nothing academic gives no proposals (and no error)', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const r = await parse(
      agent,
      'Buenas tardes estudiantes, espero que estén bien. Gracias por su atención.',
    );
    expect(r.inbox.status).toBe('OK');
    expect(r.inbox.proposals).toEqual([]);
  });
});

describe('what the user’s context decides', () => {
  it('a user without a period still gets proposals, with no subject, and period null', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const r = await parse(agent, MESSAGE);
    expect(r.period).toBeNull();
    expect(r.inbox.proposals.map((p) => p.type)).toEqual(['EXAM', 'WORKSHOP']);
    expect(r.inbox.proposals.every((p) => p.subjectId === null)).toBe(true);
  });

  it('a period without subjects: the subject is missing, never invented or created', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await agent.post('/api/periods').send(periodInput).expect(201);
    const r = await parse(agent, MESSAGE);
    expect(r.inbox.proposals.every((p) => p.subjectId === null && p.status === 'INCOMPLETE')).toBe(
      true,
    );
    expect(await prisma.subject.count()).toBe(0);
  });

  it('several proposals, each with its own subject, date and time', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const bases = await subjectOf(agent, period.id, 'Bases de Datos');
    const r = await parse(
      agent,
      'El martes tendremos parcial de Redes a las 10am y el viernes debemos entregar el taller de Bases.',
    );
    expect(
      r.inbox.proposals.map((p) => [p.type, p.subjectId, p.dueDate, p.dueTime, p.status]),
    ).toEqual([
      ['EXAM', subject.id, '2026-10-06', '10:00', 'COMPLETE'],
      ['WORKSHOP', bases.id, '2026-10-09', null, 'COMPLETE'],
    ]);
    expect(r.period).toMatchObject({ startDate: '2026-08-03', endDate: '2026-11-28' });
  });

  it('an incomplete proposal keeps what was understood', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const r = await parse(agent, 'Entregar taller el viernes.');
    expect(r.inbox.proposals).toHaveLength(1);
    expect(r.inbox.proposals[0]).toMatchObject({
      type: 'WORKSHOP',
      subjectId: null,
      dueDate: '2026-10-09',
      status: 'INCOMPLETE',
    });
  });

  it('two similar subjects are ambiguous: both are offered and none is chosen', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Programación I');
    await subjectOf(agent, period.id, 'Programación II');
    const r = await parse(agent, 'El martes tendremos parcial de Programación.');
    const [p] = r.inbox.proposals;
    expect(p!.subjectId).toBeNull();
    expect(p!.ambiguities[0]!.candidates.map((c) => c.name)).toEqual([
      'Programación I',
      'Programación II',
    ]);
    expect(codes(p!)).toContain('AMBIGUOUS_SUBJECT');
  });

  it('a date outside the period is flagged, not corrected', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const r = await parse(agent, 'El parcial de Redes es el 15/12.');
    expect(r.inbox.proposals[0]!.dueDate).toBe('2026-12-15');
    expect(codes(r.inbox.proposals[0]!)).toContain('DATE_OUTSIDE_PERIOD');
  });

  it('"today" is the user’s local day', async () => {
    const { agent, user } = await setupUser(app, 'tokyo@example.com', 'Redes');
    now = new Date('2026-10-06T03:00:00.000Z'); // Mon 22:00 Bogotá = Tue 12:00 Tokyo
    expect((await parse(agent, 'Hoy tenemos parcial de Redes.')).inbox.proposals[0]!.dueDate).toBe(
      '2026-10-05',
    );
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Asia/Tokyo' } });
    expect((await parse(agent, 'Hoy tenemos parcial de Redes.')).inbox.proposals[0]!.dueDate).toBe(
      '2026-10-06',
    );
  });

  it('is limited to 10 proposals and warns', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const text = Array.from(
      { length: 12 },
      (_, i) => `Parcial de Redes el ${String(6 + i).padStart(2, '0')}/10.`,
    ).join('\n');
    const r = await parse(agent, text);
    expect(r.inbox.proposals).toHaveLength(ACADEMIC_INBOX_MAX_PROPOSALS);
    expect(r.inbox.warnings.map((w) => w.code)).toEqual(['TOO_MANY_PROPOSALS']);
  });
});

describe('ownership: only the user’s data is ever seen', () => {
  it('another user’s subject is never matched and its id never appears', async () => {
    const a = await setupUser(app, 'a@example.com', 'Redes');
    const b = await setupUser(app, 'b@example.com', 'Anatomía');
    const mine = await parse(a.agent, 'El martes tendremos parcial de Anatomía.');
    expect(mine.inbox.proposals[0]!.subjectId).toBeNull();
    expect(JSON.stringify(mine)).not.toContain(b.subject.id);
    expect(
      (await parse(b.agent, 'El martes tendremos parcial de Anatomía.')).inbox.proposals[0]!
        .subjectId,
    ).toBe(b.subject.id);
  });

  it('a subject of an older (not current) period is not offered', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const old = (
      await agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Anterior', startDate: '2026-01-15', endDate: '2026-06-30' })
    ).body.period;
    const oldSubject = await subjectOf(agent, old.id, 'Anatomía');
    const r = await parse(agent, 'El martes tendremos parcial de Anatomía.');
    expect(r.inbox.proposals[0]!.subjectId).toBeNull();
    expect(JSON.stringify(r)).not.toContain(oldSubject.id);
  });
});

describe('possible duplicates', () => {
  const message = 'El próximo martes 13 de octubre tendremos el primer parcial de Redes.';

  it('warns when the user already has a similar activity (same subject, day, type and title)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const existing = await postActivity(agent, subject.id, {
      title: 'Parcial 1',
      type: 'EXAM',
      dueDate: '2026-10-13',
      dueTime: '10:00',
    });
    const r = await parse(agent, message);
    const [p] = r.inbox.proposals;
    expect(p).toMatchObject({ type: 'EXAM', title: 'Parcial 1', dueDate: '2026-10-13' });
    expect(p!.duplicateOf).toEqual({ id: existing.body.activity.id, title: 'Parcial 1' });
    expect(codes(p!)).toContain('POSSIBLE_DUPLICATE');
  });

  it('a completed activity counts too (it still exists)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const existing = (
      await postActivity(agent, subject.id, {
        title: 'Parcial 1',
        type: 'EXAM',
        dueDate: '2026-10-13',
      })
    ).body.activity;
    await agent.patch(`/api/activities/${existing.id}`).send({ status: 'COMPLETED' }).expect(200);
    expect((await parse(agent, message)).inbox.proposals[0]!.duplicateOf?.id).toBe(existing.id);
  });

  it('no warning for a different title number, subject, day or type', async () => {
    const { agent, period, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const bases = await subjectOf(agent, period.id, 'Bases de Datos');
    await postActivity(agent, subject.id, {
      title: 'Parcial 2',
      type: 'EXAM',
      dueDate: '2026-10-13',
    }); // other number
    await postActivity(agent, bases.id, {
      title: 'Parcial 1',
      type: 'EXAM',
      dueDate: '2026-10-13',
    }); // other subject
    await postActivity(agent, subject.id, {
      title: 'Parcial 1',
      type: 'EXAM',
      dueDate: '2026-10-14',
    }); // other day
    await postActivity(agent, subject.id, {
      title: 'Parcial 1',
      type: 'QUIZ',
      dueDate: '2026-10-13',
    }); // other type
    const r = await parse(agent, message);
    expect(r.inbox.proposals[0]!.duplicateOf).toBeNull();
    expect(codes(r.inbox.proposals[0]!)).not.toContain('POSSIBLE_DUPLICATE');
  });

  it('ownership: another user’s equivalent activity never triggers the warning', async () => {
    const a = await setupUser(app, 'a@example.com', 'Redes');
    const b = await setupUser(app, 'b@example.com', 'Redes');
    await postActivity(b.agent, b.subject.id, {
      title: 'Parcial 1',
      type: 'EXAM',
      dueDate: '2026-10-13',
      dueTime: '10:00',
    });
    const r = await parse(a.agent, message);
    expect(r.inbox.proposals[0]!.duplicateOf).toBeNull();
    expect(JSON.stringify(r)).not.toContain(b.subject.id);
    // ...while the owner of that activity does get it.
    expect((await parse(b.agent, message)).inbox.proposals[0]!.duplicateOf).not.toBeNull();
  });

  it('only warns: the proposal can still be created', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    await postActivity(agent, subject.id, {
      title: 'Parcial 1',
      type: 'EXAM',
      dueDate: '2026-10-13',
    });
    const [p] = (await parse(agent, message)).inbox.proposals;
    const created = await agent
      .post('/api/activities')
      .send({ subjectId: p!.subjectId, title: p!.title, type: p!.type, dueDate: p!.dueDate });
    expect(created.status).toBe(201);
    expect(await prisma.activity.count()).toBe(2);
  });
});

describe('it only proposes: nothing is created or stored', () => {
  it('parsing creates no activity, reminder, subject or any other row', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const count = () =>
      Promise.all([
        prisma.activity.count(),
        prisma.reminder.count(),
        prisma.subject.count(),
        prisma.academicPeriod.count(),
        prisma.scheduleBlock.count(),
      ]);
    const before = await count();
    for (const text of [MESSAGE, 'Buenas tardes. Gracias.', '', 'x'.repeat(6000)])
      await parse(agent, text);
    expect(await count()).toEqual(before);
  });
});

describe('confirming goes through the normal Activity API, so everything downstream just works', () => {
  /** What the UI sends for each confirmed proposal: the same body as a manual creation. */
  const confirm = (
    agent: request.Agent,
    p: AcademicInboxProposal,
    over: Record<string, unknown> = {},
  ) =>
    agent.post('/api/activities').send({
      subjectId: p.subjectId,
      title: p.title,
      type: p.type,
      dueDate: p.dueDate,
      ...(p.dueTime ? { dueTime: p.dueTime } : {}),
      ...over,
    });

  it('creates both activities with their reminders, and they show in Radar, Attention, Workload and Progress', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const { inbox } = await parse(agent, MESSAGE);
    expect(inbox.proposals).toHaveLength(2);
    const [exam, workshop] = inbox.proposals as [AcademicInboxProposal, AcademicInboxProposal];
    expect(workshop.subjectId).toBeNull(); // not inferable: the student completes it

    const first = await confirm(agent, exam);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.activity).toMatchObject({
      title: 'Parcial',
      type: 'EXAM',
      subjectId: subject.id,
      hasTime: true,
      status: 'PENDING',
    });
    expect(first.body.activity.dueAt).toBe('2026-10-06T15:00:00.000Z'); // Tuesday 10:00 in Bogotá

    // The Activity API still refuses a proposal that is incomplete (no date)...
    const rejected = await confirm(agent, workshop, { dueDate: null });
    expect(rejected.status).toBe(400);
    // ...and creates it once complete (here with the subject the student picked; without one it would be a general
    // activity, which F1-2 exposes in this screen).
    const second = await confirm(agent, workshop, { subjectId: subject.id });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.activity).toMatchObject({
      title: 'Taller 2',
      type: 'WORKSHOP',
      hasTime: false,
    });

    // Phase 7: automatic reminders (only the ones still ahead of Monday 12:00).
    const reminders = (await agent.get(`/api/reminders?activityId=${first.body.activity.id}`)).body
      .reminders as { kind: string }[];
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every((r) => r.kind === 'AUTO')).toBe(true);
    // Phase 8: Radar (the exam is 22 h away).
    const radar = radarResponseSchema.parse((await agent.get('/api/radar')).body).radar;
    expect(radar.groups.immediate.map((a) => a.id)).toEqual([first.body.activity.id]);
    expect(radar.summary.upcoming + radar.summary.plannable + radar.summary.immediate).toBe(2);
    // Phase 9: "¿Qué hago ahora?".
    const attention = attentionResponseSchema.parse(
      (await agent.get('/api/attention')).body,
    ).attention;
    expect(attention.recommendation!.activity.id).toBe(first.body.activity.id);
    // Phase 10: workload of the week and progress.
    const workload = workloadResponseSchema.parse((await agent.get('/api/workload')).body).workload;
    expect(workload.totals.activityCount).toBe(2);
    expect(workload.days[1]!.activityCount).toBe(1); // Tuesday
    expect(workload.days[4]!.activityCount).toBe(1); // Friday
    const progress = progressResponseSchema.parse((await agent.get('/api/progress')).body).progress;
    expect(progress.general).toMatchObject({ total: 2, pending: 2, completed: 0 });
  });

  it('after creating them, parsing the same message flags both as possible duplicates', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const { inbox } = await parse(agent, MESSAGE);
    for (const p of inbox.proposals)
      expect((await confirm(agent, p, { subjectId: subject.id })).status).toBe(201);
    const again = (await parse(agent, MESSAGE)).inbox.proposals;
    // The exam matches (same subject); the workshop proposal has no subject, so it can not be matched.
    expect(again[0]!.duplicateOf).not.toBeNull();
    expect(again[1]!.duplicateOf).toBeNull();
  });
});

describe('efficiency', () => {
  const queries: string[] = [];
  const logged = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: 'event', level: 'query' }],
  });
  logged.$on('query', (e) => queries.push(e.query));
  const loggedApp = buildApp({ prisma: logged, clock: () => now });
  afterAll(() => logged.$disconnect());

  it('a 5000-character message, 50 subjects and 10 proposals: constant queries and fast', async () => {
    const { agent, period } = await setupUser(
      loggedApp,
      'perf@example.com',
      'Asignatura número 0 de prueba',
    );
    for (let i = 1; i < 50; i++) {
      await agent
        .post('/api/subjects')
        .send({ periodId: period.id, name: `Asignatura número ${i} de prueba` });
    }
    const body = Array.from(
      { length: 40 },
      (_, i) =>
        `En Asignatura número ${i} de prueba tendremos parcial el martes y entregaremos el taller el viernes a las 10am.`,
    )
      .join(' ')
      .slice(0, 5000);
    const run = async (text: string) => {
      queries.length = 0;
      const started = Date.now();
      const res = await agent.post('/api/academic-inbox/parse').send({ text });
      return { count: queries.length, ms: Date.now() - started, res };
    };
    const small = await run('Buenas tardes. Gracias.');
    const large = await run(body);
    const parsed = academicInboxResponseSchema.parse(large.res.body);
    expect(parsed.inbox.status).toBe('OK');
    expect(parsed.inbox.proposals).toHaveLength(ACADEMIC_INBOX_MAX_PROPOSALS);
    expect(large.count).toBeLessThanOrEqual(6); // session + period + subjects + the day's activities (+ lastUsedAt touch)
    expect(small.count).toBeLessThanOrEqual(large.count);
    console.info(
      `academic inbox: ${large.count} queries, ${large.ms} ms (5000 chars, 50 subjects, 10 proposals)`,
    );
    expect(large.ms).toBeLessThan(1500);
  });
});
