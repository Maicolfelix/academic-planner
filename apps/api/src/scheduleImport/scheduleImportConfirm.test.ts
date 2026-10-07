import { randomUUID } from 'node:crypto';
import {
  SUBJECT_COLOR_VALUES,
  confirmScheduleImportResponseSchema,
  scheduleImportResultSchema,
  toLocalParts,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORIGIN,
  buildApp,
  periodInput,
  prisma,
  resetDb,
  setupUser,
  signUp,
} from '../../test/helpers.js';
import { weeklyCalendarImage } from '../../test/scheduleImportFixtures.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import { createOcrProvider, createPdfProvider } from './providers.js';

const realOcr = createOcrProvider();
const app = buildApp({
  scheduleImport: { extraction: { ocr: realOcr, pdf: createPdfProvider() } },
});

afterAll(async () => {
  await realOcr.close();
  await prisma.$disconnect();
});
beforeEach(resetDb);

const TZ = 'America/Bogota';

const cls = (over: Record<string, unknown> = {}) => ({
  clientId: 'a',
  weekday: 3,
  startTime: '19:00',
  endTime: '20:30',
  title: 'Proyectos II',
  until: '2026-11-28',
  subject: { kind: 'NEW', name: 'Proyectos II' },
  ...over,
});
const NEW = (name: string) => ({ kind: 'NEW', name });
const EXISTING = (subjectId: string) => ({ kind: 'EXISTING', subjectId });

const confirm = (agent: request.Agent, ...classes: object[]) =>
  agent.post('/api/schedule-import/confirm').send({ classes });

/** What is stored, for "zero writes" assertions. */
const counts = async () => ({
  subjects: await prisma.subject.count(),
  blocks: await prisma.scheduleBlock.count(),
});

/** A signed-in user with a current period and NO subjects (the case the import is for). */
async function userWithoutSubjects(email: string) {
  const s = await signUp(app, email);
  const period = (await s.agent.post('/api/periods').send(periodInput)).body.period;
  return { ...s, period };
}

// ───────────────────────── The real case: an empty student imports a visual calendar ─────────────────────────

describe('a student with no subjects imports a schedule (real OCR)', () => {
  it('reading proposes NEW subjects and stores nothing; confirming creates 2 subjects and 2 classes', async () => {
    const { agent, period } = await userWithoutSubjects('real@example.com');

    const res = await agent
      .post('/api/schedule-import/parse')
      .attach('file', weeklyCalendarImage(), { filename: 'horario.png', contentType: 'image/png' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = scheduleImportResultSchema.parse(res.body);

    // Preview: two classes read correctly (the rc.2 fix is intact), both subjects NEW, nothing blocks them.
    expect(r.proposals.map((p) => [p.weekday, p.startTime, p.endTime])).toEqual([
      [3, '19:00', '20:30'],
      [6, '14:00', '16:15'],
    ]);
    expect(r.proposals.map((p) => p.subjectMatch.status)).toEqual(['MISSING', 'MISSING']);
    // the second one was read with low confidence (OCR slip in the room): it asks for a look, but nothing blocks it
    expect(r.proposals.map((p) => p.status)).toEqual(['READY', 'REVIEW']);
    expect(r.proposals[1]!.warnings.map((w) => w.code)).toEqual(['LOW_CONFIDENCE']);
    expect(r.proposals.flatMap((p) => p.missingFields)).toEqual([]);
    expect(r.proposals[0]!.proposedName).toBe('Proyectos II REMOTO Proyecto'); // the code "ZISXA-" is dropped
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 }); // reading never persists

    const body = r.proposals.map((p, i) => ({
      clientId: `p${i}`,
      weekday: p.weekday!,
      startTime: p.startTime!,
      endTime: p.endTime!,
      title: p.proposedName,
      until: p.recurrence.until,
      subject: NEW(p.proposedName),
    }));
    // The student corrects the first name, as the card allows.
    body[0] = { ...body[0]!, title: 'Proyectos II', subject: NEW('Proyectos II') };

    const done = await agent.post('/api/schedule-import/confirm').send({ classes: body });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const out = confirmScheduleImportResponseSchema.parse(done.body);
    expect(out.createdSubjects.map((s) => s.name)).toEqual([
      'Proyectos II',
      r.proposals[1]!.proposedName,
    ]);
    expect(out.reusedSubjects).toEqual([]);
    expect(out.createdBlocks.map((b) => b.clientId)).toEqual(['p0', 'p1']);

    expect(await counts()).toEqual({ subjects: 2, blocks: 2 });
    const blocks = await prisma.scheduleBlock.findMany({ orderBy: { startAt: 'asc' } });
    expect(
      blocks.map((b) => [
        b.type,
        toLocalParts(b.startAt, TZ).time,
        toLocalParts(b.endAt, TZ).time,
        b.recurrenceType,
        b.periodId,
      ]),
    ).toEqual([
      ['CLASS', '19:00', '20:30', 'WEEKLY', period.id], // first Wednesday
      ['CLASS', '14:00', '16:15', 'WEEKLY', period.id], // first Saturday
    ]);
    // Re-reading the same file now recognises both classes as already in the agenda.
    const again = scheduleImportResultSchema.parse(
      (
        await agent
          .post('/api/schedule-import/parse')
          .attach('file', weeklyCalendarImage(), { filename: 'h.png', contentType: 'image/png' })
      ).body,
    );
    expect(again.proposals.every((p) => p.duplicateOf !== null)).toBe(true);
  }, 60_000);
});

// ───────────────────────── Creating and reusing subjects ─────────────────────────

describe('confirm: subjects', () => {
  it('creates a NEW subject and its class, with everything derived by the server', async () => {
    const { agent, period, user } = await userWithoutSubjects('new@example.com');
    const res = await confirm(agent, cls());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const out = confirmScheduleImportResponseSchema.parse(res.body);
    expect(out.createdSubjects).toHaveLength(1);
    expect(out.reusedSubjects).toEqual([]);
    expect(out.createdBlocks[0]).toMatchObject({
      clientId: 'a',
      block: { title: 'Proyectos II', subjectId: out.createdSubjects[0]!.id, startTime: '19:00' },
    });

    const subject = await prisma.subject.findFirstOrThrow();
    expect(subject).toMatchObject({
      name: 'Proyectos II',
      nameKey: 'proyectos ii',
      userId: user.id,
      periodId: period.id,
      professor: null,
      description: null,
    });
    expect(SUBJECT_COLOR_VALUES as readonly string[]).toContain(subject.color);
    const block = await prisma.scheduleBlock.findFirstOrThrow();
    expect(block).toMatchObject({ subjectId: subject.id, userId: user.id, periodId: period.id });
    expect(toLocalParts(block.startAt, TZ)).toMatchObject({ date: '2026-08-05', time: '19:00' }); // first Wednesday
  });

  it('an existing subject is reused, whether picked or named: still one subject', async () => {
    const { agent, subject } = await setupUser(app, 'reuse@example.com', 'Redes');
    const res = await confirm(
      agent,
      cls({ clientId: 'a', title: 'Redes', subject: EXISTING(subject.id) }),
      cls({ clientId: 'b', weekday: 5, title: 'Redes', subject: NEW('  REDES ') }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const out = confirmScheduleImportResponseSchema.parse(res.body);
    expect(out.createdSubjects).toEqual([]);
    expect(out.reusedSubjects).toEqual([{ id: subject.id, name: 'Redes' }]);
    expect(await counts()).toEqual({ subjects: 1, blocks: 2 });
  });

  it('several classes of the same new subject create ONE subject', async () => {
    const { agent } = await userWithoutSubjects('multi@example.com');
    const res = await confirm(
      agent,
      cls({
        clientId: 'a',
        weekday: 1,
        startTime: '08:00',
        endTime: '10:00',
        subject: NEW('Redes de Computadores'),
      }),
      cls({
        clientId: 'b',
        weekday: 3,
        startTime: '10:00',
        endTime: '12:00',
        subject: NEW('redes de computadores'),
      }),
      cls({
        clientId: 'c',
        weekday: 5,
        startTime: '08:00',
        endTime: '10:00',
        subject: NEW('Redes  de  Computadores'),
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(await counts()).toEqual({ subjects: 1, blocks: 3 });
    const subjectId = (await prisma.subject.findFirstOrThrow()).id;
    expect((await prisma.scheduleBlock.findMany()).every((b) => b.subjectId === subjectId)).toBe(
      true,
    );
  });

  it('two different new subjects are two subjects with different colors', async () => {
    const { agent } = await userWithoutSubjects('two@example.com');
    const res = await confirm(
      agent,
      cls({ clientId: 'a', subject: NEW('Proyectos II') }),
      cls({
        clientId: 'b',
        weekday: 6,
        startTime: '14:00',
        endTime: '16:15',
        subject: NEW('Prácticas Empresariales'),
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await counts()).toEqual({ subjects: 2, blocks: 2 });
    const colors = (await prisma.subject.findMany()).map((s) => s.color);
    expect(new Set(colors).size).toBe(2);
  });

  it('never merges by similarity: "Proyecto II" does not become "Proyectos II"', async () => {
    const { agent, subject } = await setupUser(app, 'fuzzy@example.com', 'Proyectos II');
    const res = await confirm(agent, cls({ title: 'Proyecto II', subject: NEW('Proyecto II') }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(res.body.createdSubjects[0].id).not.toBe(subject.id);
    expect(await prisma.subject.count()).toBe(2);
  });

  it('the new subject takes a palette color the period does not use yet', async () => {
    const { agent, period } = await userWithoutSubjects('color@example.com');
    await agent
      .post('/api/subjects')
      .send({ periodId: period.id, name: 'Redes', color: SUBJECT_COLOR_VALUES[0] });
    const res = await confirm(agent, cls());
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects[0].color).toBe(SUBJECT_COLOR_VALUES[1]);
  });
});

// ───────────────────────── Isolation ─────────────────────────

describe('confirm: isolation', () => {
  it('a subject of ANOTHER user is never reachable: the same 404 as one that does not exist', async () => {
    const a = await setupUser(app, 'owner@example.com', 'Proyectos II');
    const b = await userWithoutSubjects('intruder@example.com');
    const foreign = await confirm(b.agent, cls({ subject: EXISTING(a.subject.id) }));
    const nonexistent = await confirm(b.agent, cls({ subject: EXISTING(randomUUID()) }));
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(nonexistent.status);
    expect(foreign.body).toEqual(nonexistent.body);
    expect(foreign.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.scheduleBlock.count()).toBe(0);
    expect(await prisma.subject.count({ where: { userId: b.user.id } })).toBe(0);
  });

  it('the same name in another user does not reuse that user subject', async () => {
    const a = await setupUser(app, 'ana@example.com', 'Proyectos II');
    const b = await userWithoutSubjects('beto@example.com');
    const res = await confirm(b.agent, cls());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(res.body.createdSubjects[0].id).not.toBe(a.subject.id);
    expect(res.body.reusedSubjects).toEqual([]);
    expect(await prisma.subject.count({ where: { userId: a.user.id } })).toBe(1);
    expect(await prisma.scheduleBlock.count({ where: { userId: a.user.id } })).toBe(0);
  });

  it('a subject of an earlier period is not reused: the current period gets its own', async () => {
    const {
      agent,
      subject: old,
      period: first,
    } = await setupUser(app, 'hist@example.com', 'Proyectos II');
    const second = (
      await agent.post('/api/periods').send({
        name: 'Primer semestre 2027',
        startDate: '2027-02-01',
        endDate: '2027-06-05',
        isCurrent: true,
      })
    ).body.period;
    expect(second.id).not.toBe(first.id);

    const res = await confirm(agent, cls({ until: '2027-06-05' }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(res.body.createdSubjects[0].periodId).toBe(second.id);
    expect(res.body.createdSubjects[0].id).not.toBe(old.id);
    expect(await prisma.subject.count()).toBe(2);
    expect((await prisma.scheduleBlock.findFirstOrThrow()).periodId).toBe(second.id);
  });

  it('an existing subject of the user but from ANOTHER period is refused, writing nothing', async () => {
    const { agent, subject: old } = await setupUser(
      app,
      'other-period@example.com',
      'Proyectos II',
    );
    await agent
      .post('/api/periods')
      .send({ name: 'Siguiente', startDate: '2027-02-01', endDate: '2027-06-05', isCurrent: true });
    const before = await counts();
    const res = await confirm(
      agent,
      cls({ clientId: 'ok', subject: NEW('Nueva'), until: '2027-06-05' }),
      cls({ clientId: 'x', subject: EXISTING(old.id), until: '2027-06-05' }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.details.items).toEqual([
      expect.objectContaining({
        clientId: 'x',
        fields: { subjectId: ['La asignatura debe pertenecer al mismo periodo.'] },
      }),
    ]);
    expect(await counts()).toEqual(before);
  });

  it('the client cannot choose the period or the owner: such fields are refused', async () => {
    const a = await setupUser(app, 'victim@example.com', 'Redes');
    const b = await userWithoutSubjects('attacker@example.com');
    const attempts = [
      { classes: [cls()], userId: a.user.id },
      { classes: [cls()], periodId: a.period.id },
      { classes: [cls({ periodId: a.period.id })] },
      { classes: [cls({ userId: a.user.id })] },
      { classes: [cls({ subject: { kind: 'NEW', name: 'X', periodId: a.period.id } })] },
      { classes: [cls({ subject: { kind: 'NEW', name: 'X', color: '#000000' } })] },
      { classes: [cls({ subject: { kind: 'NEW', name: 'X', nameKey: 'redes' } })] },
      { classes: [cls({ subject: { kind: 'NEW', name: 'X', userId: a.user.id } })] },
      { classes: [cls({ createdAt: '2000-01-01T00:00:00.000Z' })] },
    ];
    for (const body of attempts) {
      const res = await b.agent.post('/api/schedule-import/confirm').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await counts()).toEqual({ subjects: 1, blocks: 0 }); // only victim's own subject
  });

  it('needs a current period', async () => {
    const { agent } = await signUp(app, 'noperiod@example.com');
    const res = await confirm(agent, cls());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });
});

// ───────────────────────── All or nothing ─────────────────────────

describe('confirm: all or nothing', () => {
  it('an invalid new subject name writes nothing', async () => {
    const { agent } = await userWithoutSubjects('badname@example.com');
    for (const name of ['', '    ', 'x'.repeat(101)]) {
      const res = await confirm(
        agent,
        cls({ clientId: 'ok' }),
        cls({ clientId: 'bad', subject: NEW(name) }),
      );
      expect(res.status, name).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });

  it('an invalid class rolls back the valid ones and the subjects already created (rows were written first)', async () => {
    const { agent } = await userWithoutSubjects('rollback@example.com');
    const res = await confirm(
      agent,
      cls({ clientId: 'good1', subject: NEW('Redes') }),
      cls({ clientId: 'good2', weekday: 2, subject: NEW('Cálculo') }),
      // valid for the schema, refused by the Schedule rules: the series would end after the period
      cls({ clientId: 'bad', weekday: 5, until: '2027-03-01', subject: NEW('Física') }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.details.items).toEqual([
      expect.objectContaining({
        clientId: 'bad',
        code: 'VALIDATION_ERROR',
        fields: { recurrence: [expect.stringMatching(/fin del periodo/)] },
      }),
    ]);
    expect(res.body.error.message).toMatch(/no se importó nada/);
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });

  it('reports EVERY refused class at once', async () => {
    const { agent } = await userWithoutSubjects('every@example.com');
    const res = await confirm(
      agent,
      cls({ clientId: 'one', until: '2027-03-01' }),
      cls({ clientId: 'two', weekday: 2, until: '2027-03-01', subject: NEW('Otra') }),
      cls({ clientId: 'fine', weekday: 4, subject: NEW('Buena') }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.details.items.map((i: { clientId: string }) => i.clientId)).toEqual([
      'one',
      'two',
    ]);
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });

  it('a foreign subject in the batch ends it with the usual 404 and writes nothing', async () => {
    const a = await setupUser(app, 'o1@example.com', 'Redes');
    const b = await userWithoutSubjects('o2@example.com');
    const res = await confirm(
      b.agent,
      cls({ clientId: 'ok', subject: NEW('Cálculo') }),
      cls({ clientId: 'foreign', weekday: 2, subject: EXISTING(a.subject.id) }),
    );
    expect(res.status).toBe(404);
    expect(await prisma.subject.count({ where: { userId: b.user.id } })).toBe(0);
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('a failure of the DATABASE after some writes also leaves nothing behind (and is not a client error)', async () => {
    const { agent } = await userWithoutSubjects('dbfail@example.com');
    // The schema accepts a NUL character; PostgreSQL refuses it in text. The first class is written before the
    // second one blows up, so this proves the rollback of real rows, not only of validation.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await confirm(
      agent,
      cls({ clientId: 'ok', subject: NEW('Nueva') }),
      cls({ clientId: 'boom', weekday: 2, title: 'a\u0000b', subject: NEW('Otra') }),
    );
    quiet.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/NUL|0x00|byte sequence/i); // nothing internal leaks
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });
});

// ───────────────────────── Duplicates ─────────────────────────

describe('confirm: duplicates', () => {
  it('confirming the same batch twice does not duplicate anything: the second is refused', async () => {
    const { agent } = await userWithoutSubjects('twice@example.com');
    expect((await confirm(agent, cls())).status).toBe(201);
    const second = await confirm(agent, cls());
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_CLASS');
    expect(second.body.error.details.items).toEqual([
      expect.objectContaining({ clientId: 'a', code: 'DUPLICATE_CLASS' }),
    ]);
    expect(await counts()).toEqual({ subjects: 1, blocks: 1 });
  });

  it('a class already in the agenda (made by hand) is refused and the rest of the batch is not saved', async () => {
    const { agent, subject, period } = await setupUser(app, 'dup@example.com', 'Redes');
    await agent.post('/api/schedule').send({
      type: 'CLASS',
      subjectId: subject.id,
      title: 'Redes',
      date: '2026-08-03',
      startTime: '08:00',
      endTime: '10:00',
      recurrence: { frequency: 'WEEKLY', until: period.endDate },
    });
    const res = await confirm(
      agent,
      cls({ clientId: 'fresh', subject: NEW('Cálculo') }),
      cls({
        clientId: 'dup',
        weekday: 1,
        startTime: '08:00',
        endTime: '10:00',
        title: 'Redes',
        subject: EXISTING(subject.id),
      }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.details.items.map((i: { clientId: string }) => i.clientId)).toEqual([
      'dup',
    ]);
    expect(await counts()).toEqual({ subjects: 1, blocks: 1 });
  });

  it('the same class twice inside one batch is refused', async () => {
    const { agent } = await userWithoutSubjects('inbatch@example.com');
    const res = await confirm(
      agent,
      cls({ clientId: 'a' }),
      cls({ clientId: 'b', title: 'Otra vez' }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.details.items.map((i: { clientId: string }) => i.clientId)).toEqual([
      'b',
    ]);
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });

  it('an overlap with a different class is a warning, not a refusal (the Schedule rule)', async () => {
    const { agent } = await userWithoutSubjects('overlap@example.com');
    const res = await confirm(
      agent,
      cls({ clientId: 'a', subject: NEW('Redes'), title: 'Redes' }),
      cls({
        clientId: 'b',
        startTime: '20:00',
        endTime: '21:00',
        subject: NEW('Bases'),
        title: 'Bases',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await counts()).toEqual({ subjects: 2, blocks: 2 });
  });
});

// ───────────────────────── Concurrency ─────────────────────────

describe('confirm: concurrency (real simultaneous requests)', () => {
  it('two identical confirmations: one wins (201), the other is refused as a duplicate (409); 1 subject, 1 class', async () => {
    const { agent } = await userWithoutSubjects('race1@example.com');
    const [r1, r2] = await Promise.all([confirm(agent, cls()), confirm(agent, cls())]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe('DUPLICATE_CLASS');
    expect(await counts()).toEqual({ subjects: 1, blocks: 1 });
  });

  it('two identical confirmations on an EXISTING subject (no subject insert to serialize them): still one class', async () => {
    // The unique subject index already makes two NEW-subject confirmations wait for each other; here nothing does,
    // so this is what proves the per-user lock: without it both would see "no such class yet" and save it twice.
    const { agent, subject } = await setupUser(app, 'race0@example.com', 'Redes');
    const body = cls({ title: 'Redes', subject: EXISTING(subject.id) });
    const results = await Promise.all(Array.from({ length: 4 }, () => confirm(agent, body)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await counts()).toEqual({ subjects: 1, blocks: 1 });
  });

  it('two confirmations of the same new subject with different classes: both succeed and share ONE subject', async () => {
    const { agent } = await userWithoutSubjects('race2@example.com');
    const [r1, r2] = await Promise.all([
      confirm(agent, cls({ clientId: 'a', weekday: 1, startTime: '08:00', endTime: '10:00' })),
      confirm(agent, cls({ clientId: 'b', weekday: 3, startTime: '10:00', endTime: '12:00' })),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    // exactly one of them created it, the other reused it
    const created = [r1, r2].map((r) => r.body.createdSubjects.length).sort();
    expect(created).toEqual([0, 1]);
    expect(await counts()).toEqual({ subjects: 1, blocks: 2 });
  });

  it('a confirmation racing a plain POST /api/subjects of the same name: no error 500, one subject', async () => {
    const { agent, period } = await userWithoutSubjects('race3@example.com');
    for (let i = 0; i < 6; i++) {
      const name = `Materia ${i}`;
      const [c, s] = await Promise.all([
        confirm(agent, cls({ clientId: 'a', subject: NEW(name), title: name })),
        agent.post('/api/subjects').send({ periodId: period.id, name }),
      ]);
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect([201, 409]).toContain(s.status);
      expect(await prisma.subject.count({ where: { nameKey: name.toLowerCase() } })).toBe(1);
      await prisma.scheduleBlock.deleteMany();
    }
  });

  it('inserting a subject that already exists neither fails nor aborts the transaction (what the race with a plain POST relies on)', async () => {
    const { user, period } = await userWithoutSubjects('conflict@example.com');
    await prisma.subject.create({
      data: {
        userId: user.id,
        periodId: period.id,
        name: 'Redes',
        nameKey: 'redes',
        color: '#3B82F6',
      },
    });
    const out = await prisma.$transaction(async (tx) => {
      const r = await createSubjectRepository(tx).createIfAbsent({
        userId: user.id,
        periodId: period.id,
        name: 'REDES',
        nameKey: 'redes',
        color: '#EF4444',
        professor: null,
        description: null,
      });
      // a plain INSERT would have raised a unique violation and every query from here on would fail
      return { created: r.created, name: r.subject.name, after: await tx.subject.count() };
    });
    expect(out).toEqual({ created: false, name: 'Redes', after: 1 });
  });

  it('two users confirming the same name at the same time do not interfere', async () => {
    const a = await userWithoutSubjects('u1@example.com');
    const b = await userWithoutSubjects('u2@example.com');
    const [r1, r2] = await Promise.all([confirm(a.agent, cls()), confirm(b.agent, cls())]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(await counts()).toEqual({ subjects: 2, blocks: 2 });
  });
});

// ───────────────────────── Request hygiene ─────────────────────────

describe('confirm: the request', () => {
  it('needs a session', async () => {
    const res = await request(app)
      .post('/api/schedule-import/confirm')
      .send({ classes: [cls()] });
    expect(res.status).toBe(401);
  });

  it('refuses another origin (CSRF) and writes nothing', async () => {
    const { agent } = await userWithoutSubjects('csrf@example.com');
    const res = await agent
      .post('/api/schedule-import/confirm')
      .set('Origin', 'https://evil.example')
      .send({ classes: [cls()] });
    expect(res.status).toBe(403);
    const ok = await agent
      .post('/api/schedule-import/confirm')
      .set('Origin', ORIGIN)
      .send({ classes: [cls()] });
    expect(ok.status).toBe(201);
    expect(await counts()).toEqual({ subjects: 1, blocks: 1 });
  });

  it('refuses malformed, mistyped or oversized bodies the way the rest of the API does', async () => {
    const { agent } = await userWithoutSubjects('hygiene@example.com');
    const post = () => agent.post('/api/schedule-import/confirm');
    expect(
      (await post().set('Content-Type', 'application/json').send('{"classes": [')).body.error.code,
    ).toBe('INVALID_JSON');
    expect((await post().set('Content-Type', 'text/plain').send('classes')).status).toBe(415);
    // only the READING route takes a file; the confirmation is JSON and nothing else
    expect((await post().attach('file', Buffer.from('x'), 'a.png')).status).toBe(415);
    expect((await post().send({})).status).toBe(400);
    expect((await post().send({ classes: [] })).status).toBe(400);
    expect((await post().send({ classes: 'x' })).status).toBe(400);
    expect(
      (
        await post()
          .set('Content-Type', 'application/json')
          .send(JSON.stringify([cls()]))
      ).status,
    ).toBe(400);
    const many = Array.from({ length: 41 }, (_, i) =>
      cls({ clientId: `c${i}`, subject: NEW(`M${i}`) }),
    );
    expect((await post().send({ classes: many })).status).toBe(400);
    const huge = await post().send({ classes: [cls({ title: 'x'.repeat(150_000) })] });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });

  it('keeps a hostile name as plain text: it is data, never markup', async () => {
    const { agent } = await userWithoutSubjects('xss@example.com');
    const name = '<img src=x onerror=alert(1)>Redes';
    const res = await confirm(agent, cls({ title: name, subject: NEW(name) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.createdSubjects[0].name).toBe(name);
    expect(res.body.createdBlocks[0].block.title).toBe(name);
  });
});

// ───────────────────────── Review follow-ups: what counts as a duplicate, bounded waits, error mapping ─────────────────────────

describe('confirm: duplicate semantics (a block is refused only when it is the same class on the same dates)', () => {
  /** The class already in the agenda: Wednesdays 19:00-20:30, made through the ordinary form. */
  async function withSeries(date = '2026-08-05', until = '2026-09-30') {
    const u = await setupUser(app, `dups${Math.random()}@example.com`, 'Proyectos II');
    const res = await u.agent.post('/api/schedule').send({
      type: 'CLASS',
      subjectId: u.subject.id,
      title: 'Proyectos II',
      date,
      startTime: '19:00',
      endTime: '20:30',
      recurrence: { frequency: 'WEEKLY', until },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return u;
  }

  it('A/B: the same class on overlapping dates is refused, whatever its title', async () => {
    const { agent, subject } = await withSeries();
    const res = await confirm(
      agent,
      cls({ title: 'Otro título', subject: EXISTING(subject.id), until: '2026-11-28' }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.details.items[0]).toMatchObject({
      clientId: 'a',
      code: 'DUPLICATE_CLASS',
    });
    expect(await prisma.scheduleBlock.count()).toBe(1);
  });

  it('E: a second series of the same class on DISJOINT dates is legitimate and is imported', async () => {
    // already in the agenda: Wednesdays from October 7th; the student ends the imported series on September 30th
    const { agent, subject } = await withSeries('2026-10-07', '2026-11-25');
    const disjoint = await confirm(
      agent,
      cls({ subject: EXISTING(subject.id), until: '2026-09-30' }),
    );
    expect(disjoint.status, JSON.stringify(disjoint.body)).toBe(201);
    expect(await prisma.scheduleBlock.count()).toBe(2);
    // one more Wednesday of overlap and it is the same class again
    const touching = await confirm(
      agent,
      cls({ clientId: 'b', subject: EXISTING(subject.id), until: '2026-10-14', title: 'Otra vez' }),
    );
    expect(touching.status).toBe(409);
    expect(await prisma.scheduleBlock.count()).toBe(2);
  });

  it('C: a partial overlap (other time) is a warning, never a refusal', async () => {
    const { agent, subject } = await withSeries();
    const res = await confirm(
      agent,
      cls({ subject: EXISTING(subject.id), startTime: '20:00', endTime: '21:00' }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await prisma.scheduleBlock.count()).toBe(2);
  });

  it('D: the same subject and time on ANOTHER weekday is a different class', async () => {
    const { agent, subject } = await withSeries();
    const res = await confirm(agent, cls({ subject: EXISTING(subject.id), weekday: 4 }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe('confirm: all or nothing with an EXISTING subject', () => {
  it('a valid class of an existing subject is not saved when another class of the batch is refused', async () => {
    const { agent, subject } = await setupUser(app, 'exist-fail@example.com', 'Redes');
    const before = await counts();
    const res = await confirm(
      agent,
      cls({ clientId: 'ok', title: 'Redes', subject: EXISTING(subject.id) }),
      cls({ clientId: 'bad', weekday: 5, until: '2027-03-01', subject: NEW('Física') }),
    );
    expect(res.status).toBe(400);
    expect(await counts()).toEqual(before); // no block of the batch, no new subject
    expect(await prisma.subject.findMany({ select: { name: true } })).toEqual([{ name: 'Redes' }]);
  });
});

describe('confirm: a waiting confirmation gives up instead of holding a connection for ever', () => {
  it('answers 429 IMPORT_IN_PROGRESS when another confirmation of the same user keeps the lock', async () => {
    const patient = buildApp({
      scheduleImport: {
        extraction: { ocr: realOcr, pdf: createPdfProvider() },
        confirmLockTimeoutMs: 300,
      },
    });
    const { agent, user } = await userWithoutSubjects('lockwait@example.com');
    const impatient = request.agent(patient);
    // sign in the same user on the app with the short wait
    const login = await impatient
      .post('/api/auth/login')
      .send({ email: 'lockwait@example.com', password: 'correct horse battery' });
    expect(login.status).toBe(200);

    let released: () => void = () => undefined;
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule-import:${user.id}`}, 0))`;
        await new Promise<void>((resolve) => (released = resolve));
      },
      { timeout: 20_000 },
    );
    await new Promise((r) => setTimeout(r, 100)); // the holder has the lock
    const started = Date.now();
    const res = await confirm(impatient, cls());
    const waited = Date.now() - started;
    released();
    await holder;

    expect(res.status, JSON.stringify(res.body)).toBe(429);
    expect(res.body.error.code).toBe('IMPORT_IN_PROGRESS');
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(5000);
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
    // and once the lock is free the same user imports normally
    expect((await confirm(agent, cls())).status).toBe(201);
  });
});

describe('confirm: a refused body points at its classes', () => {
  it('returns every invalid class at once, with its clientId and its fields', async () => {
    const { agent } = await userWithoutSubjects('items@example.com');
    const res = await confirm(
      agent,
      cls({ clientId: 'good' }),
      cls({ clientId: 'badName', weekday: 2, subject: NEW('   ') }),
      cls({ clientId: 'badTime', weekday: 4, startTime: '10:00', endTime: '09:00' }),
      cls({ clientId: 'extra', weekday: 5, userId: 'x' }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const items = res.body.error.details.items as {
      clientId: string;
      fields: Record<string, string[]>;
    }[];
    expect(items.map((i) => i.clientId)).toEqual(['badName', 'badTime', 'extra']);
    expect(items[0]!.fields).toEqual({ 'subject.name': ['Ingresa un nombre.'] });
    expect(items[1]!.fields).toHaveProperty('endTime');
    expect(items[2]!.fields).toHaveProperty('_');
    expect(JSON.stringify(res.body)).not.toContain('x"'); // keys and messages only, never the submitted values
    expect(await counts()).toEqual({ subjects: 0, blocks: 0 });
  });
});
