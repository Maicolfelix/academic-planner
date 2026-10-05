import { PrismaPg } from '@prisma/adapter-pg';
import {
  attentionResponseSchema,
  progressResponseSchema,
  quickCaptureResponseSchema,
  radarResponseSchema,
  workloadResponseSchema,
  type QuickCaptureResponse,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { buildApp, periodInput, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

// "Now" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5).
const NOW = new Date('2026-10-05T17:00:00.000Z');
let now = NOW;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = NOW;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const parse = async (agent: request.Agent, text: string): Promise<QuickCaptureResponse> => {
  const res = await agent.post('/api/quick-capture/parse').send({ text });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return quickCaptureResponseSchema.parse(res.body); // also validates the whole shape
};
const subjectOf = async (agent: request.Agent, periodId: string, name: string) =>
  (await agent.post('/api/subjects').send({ periodId, name })).body.subject as {
    id: string;
    name: string;
  };
const codes = (r: QuickCaptureResponse) => r.capture.warnings.map((w) => w.code);

describe('POST /api/quick-capture/parse — access and input', () => {
  it('requires a session', async () => {
    const res = await request(app).post('/api/quick-capture/parse').send({ text: 'parcial redes' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is never cached', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const res = await agent.post('/api/quick-capture/parse').send({ text: 'parcial redes' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['no body', undefined],
    ['no text', {}],
    ['a number', { text: 5 }],
    ['null', { text: null }],
    ['an array', { text: ['parcial'] }],
    ['text over the hard cap', { text: 'x'.repeat(2001) }],
    ['a userId', { text: 'parcial redes', userId: '00000000-0000-4000-8000-000000000001' }],
    ['a periodId', { text: 'parcial redes', periodId: '00000000-0000-4000-8000-000000000001' }],
    ['a subjects list', { text: 'parcial redes', subjects: [{ id: 'x', name: 'Redes' }] }],
    ['any other key', { text: 'parcial redes', now: '2030-01-01T00:00:00Z' }],
  ])('rejects %s with a validation error', async (_label, body) => {
    const { agent } = await setupUser(app, 'a@example.com');
    const call = agent.post('/api/quick-capture/parse');
    const res = await (body === undefined ? call : call.send(body as object));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('an empty text is answered (not an error): status EMPTY', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    for (const text of ['', '   ']) {
      const r = await parse(agent, text);
      expect(r.capture.status).toBe('EMPTY');
      expect(codes(r)).toEqual(['EMPTY']);
    }
  });

  it('a text over 300 characters is answered with TOO_LONG and nothing is interpreted', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const r = await parse(agent, `parcial redes martes 10am ${'x'.repeat(300)}`);
    expect(r.capture.status).toBe('TOO_LONG');
    expect(r.capture.subjectId).toBeNull();
    expect(r.capture.warnings[0]!.message).toBe(
      'Este texto parece demasiado largo para Captura rápida.',
    );
  });

  it('unknown text gives an incomplete preview, never a 500', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const r = await parse(agent, 'asdf xyz');
    expect(r.capture.status).toBe('OK');
    expect(r.capture.missingFields).toEqual(['subject', 'date']);
  });
});

describe('what the user’s context decides', () => {
  it('a user without a period gets a proposal with no subject and period null', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const r = await parse(agent, 'parcial redes martes 10am');
    expect(r.period).toBeNull();
    expect(r.capture).toMatchObject({
      type: 'EXAM',
      subjectId: null,
      dueDate: '2026-10-06',
      dueTime: '10:00',
    });
    expect(codes(r)).toContain('MISSING_SUBJECT');
  });

  it('a period without subjects: the subject is missing, never invented or created', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await agent.post('/api/periods').send(periodInput).expect(201);
    const r = await parse(agent, 'parcial redes martes 10am');
    expect(r.capture.subjectId).toBeNull();
    expect(r.capture.missingFields).toEqual(['subject']);
    expect(await prisma.subject.count()).toBe(0);
  });

  it('recognises the user’s subject (exact, accents and case ignored)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Bases de Datos');
    for (const text of [
      'parcial bases de datos martes 10am',
      'PARCIAL BASES DE DATOS MARTES 10AM',
    ]) {
      const r = await parse(agent, text);
      expect(r.capture.subjectId).toBe(subject.id);
      expect(r.capture.certainty.subject).toBe('EXACT');
    }
    const prefix = await parse(agent, 'parcial bases martes');
    expect(prefix.capture.subjectId).toBe(subject.id);
    expect(prefix.capture.certainty.subject).toBe('LIKELY');
  });

  it('two similar subjects are ambiguous: both are offered and none is chosen', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Programación I');
    const second = await subjectOf(agent, period.id, 'Programación II');
    const r = await parse(agent, 'parcial programacion martes');
    expect(r.capture.subjectId).toBeNull();
    expect(r.capture.certainty.subject).toBe('AMBIGUOUS');
    expect(r.capture.ambiguities[0]!.candidates.map((c) => c.name)).toEqual([
      'Programación I',
      'Programación II',
    ]);
    expect(codes(r)).toContain('AMBIGUOUS_SUBJECT');
    const resolved = await parse(agent, 'parcial programacion ii martes');
    expect(resolved.capture.subjectId).toBe(second.id);
  });

  it('dates are resolved with the server clock: relative, weekday and absolute', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect((await parse(agent, 'tarea redes hoy')).capture.dueDate).toBe('2026-10-05');
    expect((await parse(agent, 'tarea redes mañana')).capture.dueDate).toBe('2026-10-06');
    expect((await parse(agent, 'tarea redes viernes')).capture.dueDate).toBe('2026-10-09');
    expect((await parse(agent, 'tarea redes 20/10 14:30')).capture).toMatchObject({
      dueDate: '2026-10-20',
      dueTime: '14:30',
    });
    now = new Date('2026-10-06T20:00:00.000Z'); // Tuesday 15:00
    expect((await parse(agent, 'tarea redes martes 10am')).capture.dueDate).toBe('2026-10-13');
    expect((await parse(agent, 'tarea redes martes 4pm')).capture.dueDate).toBe('2026-10-06');
  });

  it('"today" is the user’s local day, whatever the server or the browser say', async () => {
    const { agent, user } = await setupUser(app, 'tokyo@example.com');
    now = new Date('2026-10-06T03:00:00.000Z'); // Mon 22:00 Bogotá = Tue 12:00 Tokyo
    expect((await parse(agent, 'tarea redes hoy')).capture.dueDate).toBe('2026-10-05');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Asia/Tokyo' } });
    expect((await parse(agent, 'tarea redes hoy')).capture.dueDate).toBe('2026-10-06');
  });

  it('a date outside the period is flagged with the period’s own dates', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const r = await parse(agent, 'tarea redes 15/12');
    expect(r.capture.dueDate).toBe('2026-12-15');
    expect(codes(r)).toContain('DATE_OUTSIDE_PERIOD');
    expect(r.period).toMatchObject({ startDate: '2026-08-03', endDate: '2026-11-28' });
  });
});

describe('ownership: only the user’s subjects of the CURRENT period are ever seen', () => {
  it('another user’s subject is never matched, and its id never appears', async () => {
    const a = await setupUser(app, 'a@example.com', 'Redes');
    const b = await setupUser(app, 'b@example.com', 'Anatomía');
    const mine = await parse(a.agent, 'parcial anatomia martes');
    expect(mine.capture.subjectId).toBeNull();
    expect(JSON.stringify(mine)).not.toContain(b.subject.id);
    const theirs = await parse(b.agent, 'parcial anatomia martes');
    expect(theirs.capture.subjectId).toBe(b.subject.id);
  });

  it('two users with the same subject name each get their own id', async () => {
    const a = await setupUser(app, 'a@example.com', 'Redes');
    const b = await setupUser(app, 'b@example.com', 'Redes');
    expect((await parse(a.agent, 'parcial redes martes')).capture.subjectId).toBe(a.subject.id);
    expect((await parse(b.agent, 'parcial redes martes')).capture.subjectId).toBe(b.subject.id);
  });

  it('a subject of an older (not current) period is not offered', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const old = (
      await agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Anterior', startDate: '2026-01-15', endDate: '2026-06-30' })
    ).body.period;
    await subjectOf(agent, old.id, 'Anatomía');
    const r = await parse(agent, 'parcial anatomia martes');
    expect(r.capture.subjectId).toBeNull();
    expect(JSON.stringify(r)).not.toContain('Anatomía');
  });
});

describe('it only proposes: nothing is created', () => {
  it('parsing creates no activity, reminder, subject or any other row', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    const before = await Promise.all([
      prisma.activity.count(),
      prisma.reminder.count(),
      prisma.subject.count(),
      prisma.academicPeriod.count(),
    ]);
    for (const text of [
      'parcial redes martes 10am',
      'tarea bases viernes',
      'asdf',
      '',
      'x'.repeat(400),
    ])
      await parse(agent, text);
    const after = await Promise.all([
      prisma.activity.count(),
      prisma.reminder.count(),
      prisma.subject.count(),
      prisma.academicPeriod.count(),
    ]);
    expect(after).toEqual(before);
  });
});

describe('confirming goes through the normal Activity API, so everything downstream just works', () => {
  /** What the UI sends when the student presses "Crear actividad": the same body as a manual creation. */
  const confirm = (agent: request.Agent, c: QuickCaptureResponse['capture']) =>
    agent.post('/api/activities').send({
      subjectId: c.subjectId,
      title: c.title,
      type: c.type,
      dueDate: c.dueDate,
      ...(c.dueTime ? { dueTime: c.dueTime } : {}),
    });

  it('creates the activity, its automatic reminders, and it shows in Radar, Attention, Workload and Progress', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const { capture } = await parse(agent, 'parcial redes martes 10am');
    const created = await confirm(agent, capture);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const activity = created.body.activity;
    expect(activity).toMatchObject({
      title: 'Parcial',
      type: 'EXAM',
      subjectId: subject.id,
      status: 'PENDING',
      hasTime: true,
    });
    expect(activity.dueAt).toBe('2026-10-06T15:00:00.000Z'); // Tuesday 10:00 in Bogotá

    // Phase 7: automatic reminders (only the ones still ahead of Monday 12:00).
    const reminders = (await agent.get(`/api/reminders?activityId=${activity.id}`)).body
      .reminders as { kind: string }[];
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every((r) => r.kind === 'AUTO')).toBe(true);
    // Phase 8: Radar (22 h left: Atención inmediata).
    const radar = radarResponseSchema.parse((await agent.get('/api/radar')).body).radar;
    expect(radar.groups.immediate.map((a) => a.id)).toEqual([activity.id]);
    // Phase 9: "¿Qué hago ahora?".
    const attention = attentionResponseSchema.parse(
      (await agent.get('/api/attention')).body,
    ).attention;
    expect(attention.recommendation!.activity.id).toBe(activity.id);
    // Phase 10: workload of the week and progress.
    const workload = workloadResponseSchema.parse((await agent.get('/api/workload')).body).workload;
    expect(workload.totals.activityCount).toBe(1);
    expect(workload.days[1]!.activityCount).toBe(1); // Tuesday
    const progress = progressResponseSchema.parse((await agent.get('/api/progress')).body).progress;
    expect(progress.general).toMatchObject({ total: 1, pending: 1, completed: 0 });
  });

  it('without a time the activity keeps the usual end-of-day deadline (hasTime false)', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const { capture } = await parse(agent, 'tarea redes viernes');
    expect(capture.dueTime).toBeNull();
    const created = await confirm(agent, capture);
    expect(created.status).toBe(201);
    expect(created.body.activity).toMatchObject({ hasTime: false, type: 'TASK', title: 'Tarea' });
    expect(created.body.activity.dueAt).toBe('2026-10-10T04:59:59.999Z'); // Friday 23:59:59.999 in Bogotá
  });

  it('an edited preview is what gets created: the proposal is only a starting point', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    const bases = await subjectOf(agent, period.id, 'Bases de Datos');
    const { capture } = await parse(agent, 'parcial redes martes 10am');
    const created = await agent.post('/api/activities').send({
      subjectId: bases.id,
      title: 'Parcial 1',
      type: 'QUIZ',
      dueDate: '2026-10-08',
      dueTime: '14:00',
    });
    expect(created.body.activity).toMatchObject({
      subjectId: bases.id,
      title: 'Parcial 1',
      type: 'QUIZ',
    });
    expect(capture.subjectId).not.toBe(bases.id);
  });

  it('the Activity API still decides: an incomplete proposal cannot be created', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const { capture } = await parse(agent, 'parcial mañana');
    expect(capture.subjectId).toBeNull();
    const rejected = await confirm(agent, capture);
    expect(rejected.status).toBe(400);
    expect(await prisma.activity.count()).toBe(0);
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

  it('uses a constant number of queries and is fast with 50 subjects', async () => {
    const { agent, period } = await setupUser(loggedApp, 'perf@example.com', 'Redes');
    const one = async () => {
      queries.length = 0;
      const started = Date.now();
      const res = await agent
        .post('/api/quick-capture/parse')
        .send({ text: 'parcial asignatura numero 37 martes 10am' });
      return { count: queries.length, ms: Date.now() - started, status: res.status };
    };
    const small = await one();
    for (let i = 1; i <= 50; i++) {
      await agent
        .post('/api/subjects')
        .send({ periodId: period.id, name: `Asignatura número ${i} de prueba` });
    }
    const large = await one();
    expect(large.status).toBe(200);
    expect(large.count).toBe(small.count);
    expect(large.count).toBeLessThanOrEqual(5); // session + current period + subjects (+ lastUsedAt touch)
    expect(large.ms).toBeLessThan(1000);
    const r = quickCaptureResponseSchema.parse(
      (
        await agent
          .post('/api/quick-capture/parse')
          .send({ text: 'parcial asignatura numero 37 martes' })
      ).body,
    );
    expect(r.capture.certainty.subject).toBe('LIKELY');
    console.info(`quick capture: ${large.count} queries, ${large.ms} ms with 51 subjects`);
  });
});
