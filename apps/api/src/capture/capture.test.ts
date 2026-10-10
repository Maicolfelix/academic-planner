import { captureResponseSchema, type CaptureResponse } from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, postActivity, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

// "Now" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5).
const NOW = new Date('2026-10-05T17:00:00.000Z');
const app = buildApp({ clock: () => NOW });

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const parse = async (
  agent: request.Agent,
  text: string,
  mode?: 'QUICK' | 'INBOX',
): Promise<CaptureResponse> => {
  const res = await agent.post('/api/capture/parse').send({ text, ...(mode && { mode }) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return captureResponseSchema.parse(res.body); // also validates the whole shape
};
const subjectOf = async (agent: request.Agent, periodId: string, name: string) =>
  (await agent.post('/api/subjects').send({ periodId, name })).body.subject as {
    id: string;
    name: string;
  };

describe('POST /api/capture/parse: access and input', () => {
  it('requires a session', async () => {
    const res = await request(app).post('/api/capture/parse').send({ text: 'parcial redes' });
    expect(res.status).toBe(401);
  });

  it('is strict: a period, a user or subjects in the body are refused', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    for (const extra of [
      { periodId: period.id },
      { userId: period.id },
      { subjects: [] },
      { mode: 'X' },
    ]) {
      const res = await agent.post('/api/capture/parse').send({ text: 'parcial', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
  });

  it('never caches, never creates anything and stores no text', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await agent.post('/api/capture/parse').send({ text: 'ensayo lunes y martes' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await prisma.activity.count()).toBe(0);
    expect(await prisma.subject.count()).toBe(1); // only the one the setup made
    expect(await prisma.reminder.count()).toBe(0);
  });

  it('the mode defaults to QUICK; empty and over-limit texts are a clear status, not a 500', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    expect((await parse(agent, '   ')).capture.status).toBe('EMPTY');
    expect((await parse(agent, 'x'.repeat(301))).capture.status).toBe('TOO_LONG');
    expect((await parse(agent, 'x'.repeat(301), 'INBOX')).capture.status).toBe('OK');
    expect((await agent.post('/api/capture/parse').send({ text: 'x'.repeat(20_001) })).status).toBe(
      400,
    );
  });
});

describe('the user from the session decides what it sees', () => {
  it('matches only the own subjects of the current period', async () => {
    const a = await setupUser(app, 'a@example.com', 'Materia A');
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    const secret = await subjectOf(b.agent, b.period.id, 'Secreta de B');
    const { capture } = await parse(a.agent, 'parcial secreta de B martes');
    expect(JSON.stringify(capture)).not.toContain(secret.id);
    expect(JSON.stringify(capture)).not.toContain(b.subject.id);
    expect(capture.proposals[0]!.subject.kind).not.toBe('EXISTING');
  });

  it('a student with no subjects gets general activities, decided, in their own period', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    await agent.delete(`/api/subjects/${(await prisma.subject.findFirstOrThrow()).id}`);
    const { capture, period: p } = await parse(agent, 'Ensayo lunes, martes y jueves');
    expect(p!.id).toBe(period.id);
    expect(capture.proposals).toHaveLength(3);
    expect(capture.proposals.every((x) => x.subject.kind === 'NONE' && x.status === 'READY')).toBe(
      true,
    );
  });

  it('without a current period it still interprets (no period to check dates against)', async () => {
    const { agent } = await signUp(app, 'noperiod@example.com');
    const { capture, period } = await parse(agent, 'Ensayo martes');
    expect(period).toBeNull();
    expect(capture.proposals).toHaveLength(1);
  });
});

describe('the engine through the API', () => {
  it('the critical example: four READY proposals with their hours and no subject, nothing to correct', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const { capture } = await parse(
      agent,
      'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM',
    );
    expect(capture.proposals.map((p) => [p.title.value, p.date.value, p.time.value])).toEqual([
      ['Ensayo', '2026-10-12', '07:30'],
      ['Ensayo', '2026-10-13', '07:30'],
      ['Ensayo', '2026-10-15', '17:40'],
      ['Ensayo', '2026-10-16', '17:40'],
    ]);
    expect(
      capture.proposals.every(
        (p) => p.status === 'READY' && p.selected && p.subject.kind === 'NONE',
      ),
    ).toBe(true);
    expect(capture.corrections).toEqual([]);
  });

  it('several activities, and the READY ones are ticked', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const { capture } = await parse(agent, 'Parcial de redes martes y exposición de redes jueves');
    expect(
      capture.proposals.map((p) => [p.type.value, p.date.value, p.status, p.selected]),
    ).toEqual([
      ['EXAM', '2026-10-06', 'READY', true],
      ['PRESENTATION', '2026-10-08', 'READY', true],
    ]);
  });

  it('a pasted message uses the same engine in INBOX mode', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const { capture } = await parse(
      agent,
      'Buenas tardes. El martes a las 10 am tendremos parcial de redes. Gracias.',
      'INBOX',
    );
    expect(capture.proposals).toHaveLength(1);
    expect(capture.proposals[0]).toMatchObject({
      type: { value: 'EXAM' },
      date: { value: '2026-10-06' },
      time: { value: '10:00' },
    });
  });

  it('recurrence is a suggestion; more than 10 is refused whole, not truncated', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const rec = (await parse(agent, 'redes todos los martes y jueves')).capture;
    expect(rec.proposals).toEqual([]);
    expect(rec.suggestions).toHaveLength(1);
    const many = (
      await parse(
        agent,
        'tarea lunes, tarea martes, tarea miércoles, tarea jueves, tarea viernes, taller lunes, taller martes, taller miércoles, taller jueves, taller viernes, quiz sábado',
      )
    ).capture;
    expect(many.status).toBe('TOO_MANY_PROPOSALS');
    expect(many.proposals).toEqual([]);
  });

  it('flags what the student already has (same subject, day, type, related title): unticked, never blocked', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    await postActivity(agent, subject.id, {
      title: 'Parcial',
      type: 'EXAM',
      dueDate: '2026-10-06',
    });
    const { capture } = await parse(agent, 'Parcial de redes martes y tarea de redes jueves');
    const [exam, task] = capture.proposals;
    expect(exam!.duplicateOf).toMatchObject({ title: 'Parcial' });
    expect(exam).toMatchObject({ selected: false, status: 'READY' });
    expect(task!.duplicateOf).toBeNull();
  });

  it('a general activity is compared with the general ones', async () => {
    const { agent, user } = await setupUser(app, 'a@example.com', 'Redes');
    await prisma.subject.deleteMany({ where: { userId: user.id } }); // no subjects: general is decided
    await agent
      .post('/api/activities')
      .send({ title: 'Reunión de semillero', type: 'OTHER', dueDate: '2026-10-09' });
    const { capture } = await parse(agent, 'Reunión de semillero viernes');
    expect(capture.proposals[0]).toMatchObject({
      duplicateOf: { title: 'Reunión de semillero' },
      selected: false,
    });
  });
});
