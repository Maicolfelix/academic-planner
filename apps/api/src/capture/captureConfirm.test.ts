import { captureConfirmResponseSchema, type CaptureConfirmRequest } from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

// "Now" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5).
const NOW = new Date('2026-10-05T17:00:00.000Z');
const app = buildApp({ clock: () => NOW });

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Item = CaptureConfirmRequest['items'][number];
const item = (clientId: string, over: Partial<Item> = {}): Item => ({
  clientId,
  title: 'Ensayo',
  type: 'TASK',
  dueDate: '2026-10-12',
  dueTime: '07:30',
  subject: { kind: 'NONE' },
  ...over,
});
const confirm = (agent: request.Agent, items: Item[], extra: object = {}) =>
  agent.post('/api/capture/confirm').send({ items, ...extra });

/** The four proposals of "Ensayo lunes, martes, jueves y viernes, los dos primeros a las 7:30 y los otros a las 17:40". */
const CRITICAL: Item[] = [
  item('p1', { dueDate: '2026-10-12', dueTime: '07:30' }),
  item('p2', { dueDate: '2026-10-13', dueTime: '07:30' }),
  item('p3', { dueDate: '2026-10-15', dueTime: '17:40' }),
  item('p4', { dueDate: '2026-10-16', dueTime: '17:40' }),
];

const counts = async () => ({
  activities: await prisma.activity.count(),
  subjects: await prisma.subject.count(),
  reminders: await prisma.reminder.count(),
});

describe('POST /api/capture/confirm: access and input', () => {
  it('requires a session', async () => {
    const res = await request(app).post('/api/capture/confirm').send({ items: CRITICAL });
    expect(res.status).toBe(401);
  });

  it('is strict: the owner, the period and the status are never taken from the body', async () => {
    const { agent, period, user } = await setupUser(app, 'a@example.com', 'Redes');
    for (const extra of [{ periodId: period.id }, { userId: user.id }, { count: 3 }]) {
      const res = await confirm(agent, CRITICAL, extra);
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    for (const field of [
      { periodId: period.id },
      { userId: user.id },
      { status: 'COMPLETED' },
      { dueAt: '2026-10-12T12:00:00.000Z' },
      { reminders: [] },
    ]) {
      const res = await confirm(agent, [{ ...item('p1'), ...field } as Item]);
      expect(res.status, JSON.stringify(field)).toBe(400);
    }
    expect(await counts()).toEqual({ activities: 0, subjects: 1, reminders: 0 });
  });

  it('needs between 1 and 50 activities, with distinct client ids', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    expect((await confirm(agent, [])).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => item(`p${i}`));
    expect((await confirm(agent, tooMany)).status).toBe(400);
    expect((await confirm(agent, [item('p1'), item('p1', { dueDate: '2026-10-13' })])).status).toBe(
      400,
    );
    expect((await confirm(agent, [item('p1', { dueDate: '2026-02-31' })])).status).toBe(400);
    expect((await confirm(agent, [item('p1', { title: '   ' })])).status).toBe(400);
    expect(await counts()).toEqual({ activities: 0, subjects: 1, reminders: 0 });
  });

  it('without a current period it says so and creates nothing', async () => {
    const { agent } = await signUp(app, 'noperiod@example.com');
    const res = await confirm(agent, [item('p1')]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
    expect(await counts()).toEqual({ activities: 0, subjects: 0, reminders: 0 });
  });
});

describe('POST /api/capture/confirm: the four activities of the critical example', () => {
  it('creates all four in one request, general, in the current period, with their hours', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await confirm(agent, CRITICAL);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = captureConfirmResponseSchema.parse(res.body);
    expect(body.count).toBe(4);
    expect(body.createdSubjects).toEqual([]);
    expect(body.createdActivities.map((c) => c.clientId)).toEqual(['p1', 'p2', 'p3', 'p4']);

    const rows = await prisma.activity.findMany({ orderBy: { dueAt: 'asc' } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.subjectId === null && r.periodId === period.id)).toBe(true);
    expect(rows.every((r) => r.status === 'PENDING' && r.title === 'Ensayo')).toBe(true);
    // 07:30 and 17:40 in Bogotá (UTC-5).
    expect(rows.map((r) => r.dueAt.toISOString())).toEqual([
      '2026-10-12T12:30:00.000Z',
      '2026-10-13T12:30:00.000Z',
      '2026-10-15T22:40:00.000Z',
      '2026-10-16T22:40:00.000Z',
    ]);
    expect(rows.every((r) => r.hasTime)).toBe(true);
  });

  it('uses the same rules as the single create: automatic reminders and the end-of-day rule', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await confirm(agent, [
      item('p1', { type: 'EXAM', title: 'Parcial', dueTime: undefined, dueDate: '2026-10-20' }),
    ]);
    expect(res.status).toBe(201);
    const row = await prisma.activity.findFirstOrThrow();
    expect(row.hasTime).toBe(false); // no time: due at the end of the day
    expect(await prisma.reminder.count({ where: { activityId: row.id } })).toBeGreaterThan(0);
  });

  it('copies the student asked for in one text ("dos tareas el viernes") are all created', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await confirm(agent, [
      item('p1', { title: 'Tarea', dueDate: '2026-10-09', dueTime: undefined }),
      item('p2', { title: 'Tarea', dueDate: '2026-10-09', dueTime: undefined }),
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await prisma.activity.count()).toBe(2);
  });
});

describe('POST /api/capture/confirm: all or nothing', () => {
  it('one refused item rolls everything back, and the error points at its card', async () => {
    const owner = await setupUser(app, 'a@example.com', 'Redes');
    const other = await setupUser(app, 'b@example.com', 'Secreta');
    const res = await confirm(owner.agent, [
      item('p1'),
      item('p2', { dueDate: '2026-10-13' }),
      item('p3', {
        dueDate: '2026-10-14',
        subject: { kind: 'EXISTING', subjectId: other.subject.id },
      }),
      item('p4', { dueDate: '2026-10-15', subject: { kind: 'NEW', name: 'Ciberseguridad' } }),
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.details.items).toEqual([
      expect.objectContaining({ clientId: 'p3', code: 'SUBJECT_NOT_FOUND' }),
    ]);
    // Nothing: not the three good activities, not their reminders, not the NEW subject.
    expect(await counts()).toEqual({ activities: 0, subjects: 2, reminders: 0 });
    expect(await prisma.subject.count({ where: { name: 'Ciberseguridad' } })).toBe(0);
  });

  it("another user's subject and a subject that does not exist answer exactly the same", async () => {
    const owner = await setupUser(app, 'a@example.com', 'Redes');
    const other = await setupUser(app, 'b@example.com', 'Secreta');
    const foreign = await confirm(owner.agent, [
      item('p1', { subject: { kind: 'EXISTING', subjectId: other.subject.id } }),
    ]);
    const missing = await confirm(owner.agent, [
      item('p1', {
        subject: { kind: 'EXISTING', subjectId: '00000000-0000-4000-8000-000000000999' },
      }),
    ]);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
    expect(JSON.stringify(foreign.body)).not.toContain(other.subject.id);
  });

  it('a subject of an older period is not accepted: the period is always the current one', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const old = (
      await agent
        .post('/api/periods')
        .send({ name: 'Antiguo', startDate: '2025-01-01', endDate: '2025-06-01' })
    ).body.period;
    expect(old.isCurrent).toBe(false); // it exists, but it is not the period the student is living now
    const oldSubject = (await agent.post('/api/subjects').send({ periodId: old.id, name: 'Vieja' }))
      .body.subject;
    const res = await confirm(agent, [
      item('p1', { subject: { kind: 'EXISTING', subjectId: oldSubject.id } }),
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.details.items[0].code).toBe('SUBJECT_NOT_FOUND');
    expect(await prisma.activity.count()).toBe(0);
  });
});

describe('POST /api/capture/confirm: subjects', () => {
  it('an existing subject is used', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await confirm(agent, [
      item('p1', {
        type: 'EXAM',
        title: 'Parcial',
        subject: { kind: 'EXISTING', subjectId: subject.id },
      }),
    ]);
    expect(res.status).toBe(201);
    expect(res.body.reusedSubjects).toEqual([{ id: subject.id, name: 'Redes' }]);
    expect((await prisma.activity.findFirstOrThrow()).subjectId).toBe(subject.id);
  });

  it('a new subject shared by several activities is created ONCE, in the current period', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await confirm(agent, [
      item('p1', { subject: { kind: 'NEW', name: 'Ciberseguridad' } }),
      item('p2', { dueDate: '2026-10-13', subject: { kind: 'NEW', name: 'ciberseguridad' } }),
      item('p3', { dueDate: '2026-10-14', subject: { kind: 'NEW', name: 'Ciberseguridád ' } }),
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdSubjects).toHaveLength(1);
    const created = await prisma.subject.findMany({ where: { name: { contains: 'iber' } } });
    expect(created).toHaveLength(1);
    expect(created[0]!.periodId).toBe(period.id);
    expect(created[0]!.nameKey).toBe('ciberseguridad');
    const acts = await prisma.activity.findMany();
    expect(acts.every((a) => a.subjectId === created[0]!.id)).toBe(true);
  });

  it('a new name that already exists reuses that subject instead of duplicating it', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await confirm(agent, [item('p1', { subject: { kind: 'NEW', name: ' redes ' } })]);
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects).toEqual([]);
    expect(res.body.reusedSubjects).toEqual([{ id: subject.id, name: 'Redes' }]);
    expect(await prisma.subject.count()).toBe(1);
  });

  it('a new subject gets a color from the palette that the period does not use yet', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const first = (await prisma.subject.findFirstOrThrow()).color;
    await confirm(agent, [item('p1', { subject: { kind: 'NEW', name: 'Bases' } })]);
    const created = await prisma.subject.findFirstOrThrow({ where: { name: 'Bases' } });
    expect(created.color).not.toBe(first);
  });
});

describe('POST /api/capture/confirm: copies and double submits', () => {
  it('an exact copy of an existing activity is refused, unless the student insists', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    expect((await confirm(agent, [item('p1')])).status).toBe(201);

    const again = await confirm(agent, [item('p1')]);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DUPLICATE_ACTIVITY');
    expect(again.body.error.details.items).toEqual([
      expect.objectContaining({ clientId: 'p1', code: 'DUPLICATE_ACTIVITY' }),
    ]);
    expect(await prisma.activity.count()).toBe(1);

    const insist = await confirm(agent, [{ ...item('p1'), allowDuplicate: true }]);
    expect(insist.status).toBe(201);
    expect(await prisma.activity.count()).toBe(2);
  });

  it('a similar one (another hour, another day) is not a copy', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    await confirm(agent, [item('p1')]);
    expect((await confirm(agent, [item('p1', { dueTime: '08:30' })])).status).toBe(201);
    expect((await confirm(agent, [item('p1', { dueDate: '2026-10-13' })])).status).toBe(201);
    expect((await confirm(agent, [item('p1', { title: 'Ensayo final' })])).status).toBe(201);
  });

  it('two identical requests at the same time create the activities once', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const [a, b] = await Promise.all([confirm(agent, CRITICAL), confirm(agent, CRITICAL)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.activity.count()).toBe(4);
    expect(await prisma.reminder.count()).toBeGreaterThan(0);
  });

  it('a retry after success is not a second creation', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    await confirm(agent, CRITICAL);
    const retry = await confirm(agent, CRITICAL);
    expect(retry.status).toBe(409);
    expect(await prisma.activity.count()).toBe(4);
  });
});

describe('POST /api/capture/confirm: the description is optional context', () => {
  it('is saved with each activity, including a general one (no subject, no hour)', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await confirm(agent, [
      item('p1', {
        description: 'Estudiar VLAN, subnetting y routing estático',
        dueTime: undefined,
      }),
      item('p2', { dueDate: '2026-10-13', description: 'Hay que subirla en PDF al campus' }),
      item('p3', { dueDate: '2026-10-14' }), // none: it is optional
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await prisma.activity.findMany({ orderBy: { dueAt: 'asc' } });
    expect(rows.map((r) => r.description)).toEqual([
      'Estudiar VLAN, subnetting y routing estático',
      'Hay que subirla en PDF al campus',
      null,
    ]);
    expect(rows.every((r) => r.subjectId === null)).toBe(true);
  });

  it('is trimmed, an empty one is null, and the one the single create would refuse is refused here too', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    expect(
      (
        await confirm(agent, [
          item('p1', { description: '   ' }),
          item('p2', { dueDate: '2026-10-13', description: '  Con espacios  ' }),
        ])
      ).status,
    ).toBe(201);
    const rows = await prisma.activity.findMany({ orderBy: { dueAt: 'asc' } });
    expect(rows.map((r) => r.description)).toEqual([null, 'Con espacios']);
    // Over 2000 characters, or a NUL character: a clear 400, never a 500, and nothing is created.
    for (const description of ['x'.repeat(2001), 'a\u0000b']) {
      const bad = await confirm(agent, [item('p3', { dueDate: '2026-10-14', description })]);
      expect(bad.status, description.slice(0, 10)).toBe(400);
    }
    expect(await prisma.activity.count()).toBe(2);
  });
});

describe('POST /api/capture/confirm: fifty at once', () => {
  const fifty = (): Item[] =>
    Array.from({ length: 50 }, (_, i) =>
      item(`p${i}`, {
        title: `Taller ${i + 1}`,
        dueDate:
          i < 28
            ? `2026-12-${String(i + 1).padStart(2, '0')}`
            : `2027-01-${String(i - 27).padStart(2, '0')}`,
        dueTime: '08:00',
        type: i % 2 ? 'EXAM' : 'TASK',
        description: i % 5 === 0 ? 'Hay que llevar el portátil' : undefined,
        subject: i % 10 === 0 ? { kind: 'NEW', name: 'Criptografía' } : { kind: 'NONE' },
      }),
    );

  it('creates all fifty (and the one new subject, once, and every reminder) in one transaction, in a sensible time', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const t0 = Date.now();
    const res = await confirm(agent, fifty());
    const took = Date.now() - t0;
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
    expect(res.body.count).toBe(50);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(await prisma.activity.count()).toBe(50);
    expect(await prisma.subject.count({ where: { name: 'Criptografía' } })).toBe(1);
    expect(await prisma.reminder.count()).toBeGreaterThanOrEqual(50);
    console.info(`confirm of 50 activities: ${took} ms`);
    expect(took).toBeLessThan(15_000); // measured at a fraction of this: it only catches a blow-up (N+1 round trips)
  });

  it('is all or nothing at that size too: one refused card, none of the fifty', async () => {
    const owner = await setupUser(app, 'a@example.com', 'Redes');
    const other = await setupUser(app, 'b@example.com', 'Secreta');
    const items = fifty();
    items[37] = item('p37', { subject: { kind: 'EXISTING', subjectId: other.subject.id } });
    const res = await confirm(owner.agent, items);
    expect(res.status).toBe(400);
    expect(res.body.error.details.items.map((i: { clientId: string }) => i.clientId)).toEqual([
      'p37',
    ]);
    expect(await prisma.activity.count()).toBe(0);
    expect(await prisma.subject.count({ where: { name: 'Criptografía' } })).toBe(0);
  });
});
