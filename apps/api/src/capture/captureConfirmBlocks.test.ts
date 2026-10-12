import { type CaptureConfirmRequest } from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, prisma, resetDb, setupUser } from '../../test/helpers.js';

// "Now" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5). The test period runs 3 Aug – 28 Nov 2026.
const NOW = new Date('2026-10-05T17:00:00.000Z');
const app = buildApp({ clock: () => NOW });

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Item = NonNullable<CaptureConfirmRequest['items']>[number];
type Block = NonNullable<CaptureConfirmRequest['blocks']>[number];
const block = (clientId: string, over: Partial<Block> = {}): Block => ({
  clientId,
  type: 'CLASS',
  title: 'Ciberseguridad',
  weekday: 2,
  startTime: '18:00',
  endTime: '20:00',
  subject: { kind: 'NEW', name: 'Ciberseguridad' },
  ...over,
});
const item = (clientId: string, over: Partial<Item> = {}): Item => ({
  clientId,
  title: 'Parcial de redes',
  type: 'EXAM',
  dueDate: '2026-10-09',
  dueTime: '08:00',
  subject: { kind: 'NONE' },
  ...over,
});
const send = (agent: request.Agent, body: object) => agent.post('/api/capture/confirm').send(body);
const counts = async () => ({
  activities: await prisma.activity.count(),
  blocks: await prisma.scheduleBlock.count(),
  subjects: await prisma.subject.count(),
});

describe('POST /api/capture/confirm: weekly blocks', () => {
  it('creates "martes y jueves" as two weekly blocks of ONE new subject, in the current period', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await send(agent, {
      blocks: [block('b1', { weekday: 2 }), block('b2', { weekday: 4 })],
    });
    expect(res.status).toBe(201);
    expect(res.body.createdBlocks).toHaveLength(2);
    expect(res.body.reusedBlocks).toEqual([]);
    expect(res.body.createdSubjects).toHaveLength(1);

    const rows = await prisma.scheduleBlock.findMany({ orderBy: { startAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.periodId === period.id && r.recurrenceType === 'WEEKLY')).toBe(true);
    expect(new Set(rows.map((r) => r.subjectId)).size).toBe(1);
    // 6 pm in Bogotá is 23:00 UTC; the first Tuesday on or after 3 Aug 2026 is the 4th.
    expect(rows[0]!.startAt.toISOString()).toBe('2026-08-04T23:00:00.000Z');
    expect(rows[0]!.endAt.toISOString()).toBe('2026-08-05T01:00:00.000Z');
    expect(await prisma.subject.count()).toBe(2);
  });

  it('one request can carry an activity AND weekly blocks, and saves them together', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await send(agent, {
      items: [item('p1')],
      blocks: [block('b1', { weekday: 2 }), block('b2', { weekday: 4 })],
    });
    expect(res.status).toBe(201);
    expect(res.body.createdActivities).toHaveLength(1);
    expect(res.body.createdBlocks).toHaveLength(2);
    expect(await counts()).toEqual({ activities: 1, blocks: 2, subjects: 2 });
  });

  it('a weekly block that is already in the agenda is reused, not duplicated (also on a retry)', async () => {
    const { agent, subject } = await setupUser(app, 'a@example.com', 'Redes');
    const body = {
      blocks: [block('b1', { subject: { kind: 'EXISTING', subjectId: subject.id } })],
    };
    expect((await send(agent, body)).status).toBe(201);
    const again = await send(agent, body);
    expect(again.status).toBe(201);
    expect(again.body.createdBlocks).toEqual([]);
    expect(again.body.reusedBlocks).toHaveLength(1);
    expect(await prisma.scheduleBlock.count()).toBe(1);
  });

  it('nothing is saved when one selected block is refused (activity and new subject included)', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    // a class with no subject: the rules refuse it, and the activity and the new subject go with it
    const res = await send(agent, {
      items: [item('p1')],
      blocks: [block('b1'), block('b2', { weekday: 4, subject: { kind: 'NONE' } })],
    });
    expect(res.status).toBe(400);
    expect(await counts()).toEqual({ activities: 0, blocks: 0, subjects: 1 });
  });

  it('is strict: no period, owner or dates come from the body', async () => {
    const { agent, period, user } = await setupUser(app, 'a@example.com', 'Redes');
    for (const field of [
      { periodId: period.id },
      { userId: user.id },
      { recurrenceUntil: '2026-12-31' },
      { startAt: '2026-08-04T23:00:00.000Z' },
      { recurrence: { frequency: 'WEEKLY', until: '2030-01-01' } },
    ]) {
      const res = await send(agent, { blocks: [{ ...block('b1'), ...field }] });
      expect(res.status, JSON.stringify(field)).toBe(400);
    }
    expect((await send(agent, { blocks: [], items: [] })).status).toBe(400);
    expect(await counts()).toEqual({ activities: 0, blocks: 0, subjects: 1 });
  });

  it('rejects malformed days, times and more blocks than a normal text has', async () => {
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    for (const over of [
      { weekday: 0 },
      { weekday: 8 },
      { weekday: 1.5 },
      { startTime: '25:00' },
      { endTime: '18:00' },
      { endTime: '17:00' },
      { title: '   ' },
      { title: 'Redes\u0000' },
    ]) {
      const res = await send(agent, { blocks: [block('b1', over)] });
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    const tooMany = Array.from({ length: 22 }, (_, i) => block(`b${i}`));
    expect((await send(agent, { blocks: tooMany })).status).toBe(400);
    expect((await send(agent, { blocks: [block('b1'), block('b1', { weekday: 4 })] })).status).toBe(
      400,
    );
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('a subject of another student is "not found" and nothing is saved', async () => {
    const owner = await setupUser(app, 'a@example.com', 'Redes');
    const other = await setupUser(app, 'b@example.com', 'Secreta');
    const res = await send(owner.agent, {
      blocks: [block('b1', { subject: { kind: 'EXISTING', subjectId: other.subject.id } })],
    });
    expect(res.status).toBe(400); // like an activity: refused by card, nothing saved
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('needs a session and the same origin check as every other write', async () => {
    expect(
      (
        await request(app)
          .post('/api/capture/confirm')
          .send({ blocks: [block('b1')] })
      ).status,
    ).toBe(401);
    const { agent } = await setupUser(app, 'a@example.com', 'Redes');
    const res = await agent
      .post('/api/capture/confirm')
      .set('Origin', 'https://evil.example')
      .send({ blocks: [block('b1')] });
    expect(res.status).toBe(403);
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });
});
