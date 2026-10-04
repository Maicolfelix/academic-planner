import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApp,
  periodInput,
  postActivity,
  prisma,
  resetDb,
  setupUser,
} from '../../test/helpers.js';

// The clock is fixed so "overdue" is deterministic: dueAt < 2026-06-01T12:00Z and not completed.
const NOW = new Date('2026-06-01T12:00:00.000Z');
const app = buildApp({ clock: () => NOW });

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

/** A known data set: two subjects in two periods, five activities. */
async function dataset() {
  const ctx = await setupUser(app, 'a@example.com', 'S1');
  const { agent, subject: s1, period: p1 } = ctx;
  const p2 = (
    await agent
      .post('/api/periods')
      .send({ ...periodInput, name: 'P2', startDate: '2099-01-01', endDate: '2099-06-01' })
  ).body.period;
  const s2 = (await agent.post('/api/subjects').send({ periodId: p2.id, name: 'S2' })).body.subject;

  const make = async (title: string, subjectId: string, body: object) =>
    (await postActivity(agent, subjectId, { title, ...body })).body.activity as { id: string };

  await make('a1', s1.id, { type: 'EXAM', priority: 'HIGH', dueDate: '2020-01-10' }); // overdue, PENDING
  const a2 = await make('a2', s1.id, { type: 'TASK', priority: 'LOW', dueDate: '2020-02-10' });
  const a3 = await make('a3', s1.id, { type: 'QUIZ', priority: 'MEDIUM', dueDate: '2020-03-10' });
  await make('a4', s2.id, { type: 'PROJECT', priority: 'HIGH', dueDate: '2099-01-10' }); // future
  await make('a5', s2.id, {
    type: 'TASK',
    priority: 'MEDIUM',
    dueDate: '2099-02-10',
    dueTime: '09:00',
  });

  await agent.patch(`/api/activities/${a2.id}`).send({ status: 'IN_PROGRESS' }); // overdue, IN_PROGRESS
  await agent.patch(`/api/activities/${a3.id}`).send({ status: 'COMPLETED' }); // past but done

  return { ...ctx, s1, s2, p1, p2 };
}

const titles = (res: request.Response) =>
  res.body.activities.map((a: { title: string }) => a.title);
const q = (agent: request.Agent, query: string) => agent.get(`/api/activities${query}`);

describe('GET /api/activities', () => {
  it('lists the soonest deadline first by default', async () => {
    const { agent } = await dataset();
    expect(titles(await q(agent, ''))).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
  });

  it.each([
    ['status=PENDING', ['a1', 'a4', 'a5']],
    ['status=IN_PROGRESS', ['a2']],
    ['status=COMPLETED', ['a3']],
    ['priority=HIGH', ['a1', 'a4']],
    ['priority=MEDIUM', ['a3', 'a5']],
    ['priority=LOW', ['a2']],
    ['type=TASK', ['a2', 'a5']],
    ['type=EXAM', ['a1']],
    ['type=READING', []],
  ])('filters by %s', async (query, expected) => {
    const { agent } = await dataset();
    expect(titles(await q(agent, `?${query}`))).toEqual(expected);
  });

  it('filters by subject and by period (derived through the subject)', async () => {
    const { agent, s1, s2, p1, p2 } = await dataset();
    expect(titles(await q(agent, `?subjectId=${s1.id}`))).toEqual(['a1', 'a2', 'a3']);
    expect(titles(await q(agent, `?subjectId=${s2.id}`))).toEqual(['a4', 'a5']);
    expect(titles(await q(agent, `?periodId=${p1.id}`))).toEqual(['a1', 'a2', 'a3']);
    expect(titles(await q(agent, `?periodId=${p2.id}`))).toEqual(['a4', 'a5']);
  });

  it('overdue=true returns open activities past their deadline (completed ones never)', async () => {
    const { agent } = await dataset();
    expect(titles(await q(agent, '?overdue=true'))).toEqual(['a1', 'a2']);
  });

  it('overdue=false returns the complement: not yet due, or completed', async () => {
    const { agent } = await dataset();
    expect(titles(await q(agent, '?overdue=false'))).toEqual(['a3', 'a4', 'a5']);
  });

  it('filters by from/to, inclusive on both ends, in the user’s local days', async () => {
    const { agent } = await dataset();
    expect(titles(await q(agent, '?from=2020-02-01&to=2020-03-31'))).toEqual(['a2', 'a3']);
    expect(titles(await q(agent, '?from=2099-01-01'))).toEqual(['a4', 'a5']);
    expect(titles(await q(agent, '?to=2020-01-31'))).toEqual(['a1']);
    // A single day: an end-of-day deadline (a1) and a timed one (a5) both fall inside their own day.
    expect(titles(await q(agent, '?from=2020-01-10&to=2020-01-10'))).toEqual(['a1']);
    expect(titles(await q(agent, '?from=2099-02-10&to=2099-02-10'))).toEqual(['a5']);
    expect(titles(await q(agent, '?from=2020-01-11&to=2020-02-09'))).toEqual([]);
  });

  it('combines filters with AND', async () => {
    const { agent, s1 } = await dataset();
    expect(titles(await q(agent, '?status=PENDING&overdue=true'))).toEqual(['a1']);
    expect(titles(await q(agent, '?priority=HIGH&overdue=false'))).toEqual(['a4']);
    expect(titles(await q(agent, `?subjectId=${s1.id}&status=COMPLETED`))).toEqual(['a3']);
    expect(titles(await q(agent, '?type=TASK&priority=MEDIUM'))).toEqual(['a5']);
    expect(titles(await q(agent, '?status=COMPLETED&overdue=true'))).toEqual([]);
    expect(titles(await q(agent, '?from=2020-01-01&to=2020-12-31&status=PENDING'))).toEqual(['a1']);
  });

  it('rejects invalid filter values with VALIDATION_ERROR', async () => {
    const { agent } = await dataset();
    for (const bad of [
      '?status=DONE',
      '?priority=URGENT',
      '?type=X',
      '?overdue=maybe',
      '?subjectId=nope',
      '?from=2026-02-30',
      '?from=2026-10-10&to=2026-10-01',
    ]) {
      const res = await q(agent, bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code, bad).toBe('VALIDATION_ERROR');
    }
  });

  it('an unknown subject or period yields an empty list, not an error', async () => {
    const { agent } = await dataset();
    const ghost = '0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11';
    expect(titles(await q(agent, `?subjectId=${ghost}`))).toEqual([]);
    expect(titles(await q(agent, `?periodId=${ghost}`))).toEqual([]);
  });

  it('filters never reach another user’s activities', async () => {
    const { agent } = await dataset();
    const b = await setupUser(app, 'b@example.com', 'Otra');
    await postActivity(b.agent, b.subject.id, {
      title: 'secreta de B',
      dueDate: '2020-01-01',
      priority: 'HIGH',
    });

    for (const query of [
      '',
      '?overdue=true',
      '?priority=HIGH',
      '?status=PENDING',
      '?from=2020-01-01&to=2020-01-01',
    ]) {
      expect(titles(await q(agent, query)), query).not.toContain('secreta de B');
    }
    expect(titles(await q(agent, `?subjectId=${b.subject.id}`))).toEqual([]);
    expect(titles(await q(b.agent, ''))).toEqual(['secreta de B']);
  });

  it('applies the user’s timezone to from/to', async () => {
    const { agent, user, subject } = await setupUser(app, 'tz@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Pacific/Auckland' } });
    // 10:00 on 10 Oct in Auckland is 21:00 UTC on the 9th.
    await postActivity(agent, subject.id, { title: 'nz', dueDate: '2026-10-10', dueTime: '10:00' });
    expect(titles(await q(agent, '?from=2026-10-10&to=2026-10-10'))).toEqual(['nz']);
    expect(titles(await q(agent, '?from=2026-10-09&to=2026-10-09'))).toEqual([]);
  });
});
