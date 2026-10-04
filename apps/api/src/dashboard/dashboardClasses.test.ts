import { dashboardResponseSchema, type Dashboard } from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, prisma, resetDb, signUp } from '../../test/helpers.js';

// "Now" is Monday 1 June 2026, 12:00 in Bogotá (UTC-5).
const BOGOTA_NOON = new Date('2026-06-01T17:00:00.000Z');
let now = BOGOTA_NOON;
const app = buildApp({ clock: () => now });

beforeEach(async () => {
  now = BOGOTA_NOON;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

/** A user whose current period (19 Jan – 30 Jun 2026) contains "today", with one subject. */
async function setupJune(email: string, subjectName = 'Redes') {
  const session = await signUp(app, email);
  const period = (
    await session.agent
      .post('/api/periods')
      .send({ name: 'Primer semestre 2026', startDate: '2026-01-19', endDate: '2026-06-30' })
  ).body.period;
  const subject = (
    await session.agent.post('/api/subjects').send({ periodId: period.id, name: subjectName })
  ).body.subject;
  return { ...session, period, subject };
}

type Body = Record<string, unknown>;
const block = (subjectId: string, over: Body = {}): Body => ({
  type: 'CLASS',
  subjectId,
  title: 'Redes',
  date: '2026-06-01',
  startTime: '08:00',
  endTime: '10:00',
  ...over,
});
const post = async (agent: request.Agent, body: Body) => {
  const res = await agent.post('/api/schedule').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.block as { id: string };
};
const dashboard = async (agent: request.Agent): Promise<Dashboard> => {
  const res = await agent.get('/api/dashboard');
  expect(res.status).toBe(200);
  return dashboardResponseSchema.parse(res.body).dashboard;
};
const titles = (d: Dashboard) => d.classesToday.map((c) => c.title);

describe('Dashboard — classesToday', () => {
  it('is empty when there are no classes', async () => {
    const { agent } = await setupJune('a@example.com');
    expect((await dashboard(agent)).classesToday).toEqual([]);
  });

  it('lists today’s classes by start time: a weekly series, a single class, and nothing else', async () => {
    const { agent, subject } = await setupJune('a@example.com');
    // Mondays 08:00–10:00 from 19 January to 29 June: today (Monday 1 June) is one of its weeks.
    await post(
      agent,
      block(subject.id, {
        title: 'Redes',
        date: '2026-01-19',
        recurrence: { frequency: 'WEEKLY', until: '2026-06-29' },
      }),
    );
    await post(
      agent,
      block(subject.id, { title: 'Laboratorio', startTime: '14:00', endTime: '16:00' }),
    ); // single, today
    await post(
      agent,
      block(subject.id, {
        title: 'Del miércoles',
        date: '2026-01-21',
        recurrence: { frequency: 'WEEKLY', until: '2026-06-24' },
      }),
    ); // not Monday
    await post(agent, block(subject.id, { title: 'Mañana', date: '2026-06-02' })); // tomorrow
    await post(agent, block(subject.id, { title: 'Ayer', date: '2026-05-31' })); // yesterday

    const d = await dashboard(agent);
    expect(titles(d)).toEqual(['Redes', 'Laboratorio']);
    expect(d.classesToday[0]).toMatchObject({
      occurrenceDate: '2026-06-01',
      startAt: '2026-06-01T13:00:00.000Z', // 08:00 Bogotá
      endAt: '2026-06-01T15:00:00.000Z',
      isRecurring: true,
      type: 'CLASS',
      subject: { id: subject.id, name: 'Redes' },
    });
    expect(d.classesToday[1]).toMatchObject({ isRecurring: false });
  });

  it('shows only CLASS blocks: study sessions and other academic blocks are left out', async () => {
    const { agent, subject } = await setupJune('a@example.com');
    await post(agent, block(subject.id, { title: 'Clase' }));
    await post(
      agent,
      block(subject.id, { type: 'STUDY', title: 'Estudio', startTime: '11:00', endTime: '12:00' }),
    );
    await post(agent, {
      type: 'ACADEMIC_PERSONAL',
      title: 'Reunión',
      date: '2026-06-01',
      startTime: '13:00',
      endTime: '14:00',
    });
    expect(titles(await dashboard(agent))).toEqual(['Clase']);
  });

  it('still lists a class that has already ended today (it is the day’s timetable)', async () => {
    const { agent, subject } = await setupJune('a@example.com');
    await post(
      agent,
      block(subject.id, { title: 'Ya terminó', startTime: '06:00', endTime: '07:00' }),
    ); // before 12:00 now
    expect(titles(await dashboard(agent))).toEqual(['Ya terminó']);
  });

  it('is capped at 5, earliest first', async () => {
    const { agent, subject } = await setupJune('a@example.com');
    for (let hour = 7; hour <= 13; hour++) {
      const h = String(hour).padStart(2, '0');
      await post(
        agent,
        block(subject.id, { title: `Clase ${h}`, startTime: `${h}:00`, endTime: `${h}:50` }),
      );
    }
    expect(titles(await dashboard(agent))).toEqual([
      'Clase 07',
      'Clase 08',
      'Clase 09',
      'Clase 10',
      'Clase 11',
    ]);
  });

  it('flags overlapping classes of the day', async () => {
    const { agent, subject } = await setupJune('a@example.com');
    await post(agent, block(subject.id, { title: 'A', startTime: '08:00', endTime: '10:00' }));
    await post(agent, block(subject.id, { title: 'B', startTime: '09:00', endTime: '11:00' }));
    await post(agent, block(subject.id, { title: 'C', startTime: '11:00', endTime: '12:00' }));
    const flags = Object.fromEntries(
      (await dashboard(agent)).classesToday.map((c) => [c.title, c.hasConflict]),
    );
    expect(flags).toEqual({ A: true, B: true, C: false });
  });

  it('belongs to the CURRENT period: another period’s class today is not shown', async () => {
    const { agent, subject } = await setupJune('a@example.com');
    await post(agent, block(subject.id, { title: 'Del periodo actual' }));
    const other = (
      await agent
        .post('/api/periods')
        .send({ name: 'Otro periodo', startDate: '2026-05-01', endDate: '2026-12-31' })
    ).body.period;
    const otherSubject = (
      await agent.post('/api/subjects').send({ periodId: other.id, name: 'Otra' })
    ).body.subject;
    await post(
      agent,
      block(otherSubject.id, {
        title: 'De otro periodo',
        periodId: other.id,
        startTime: '15:00',
        endTime: '16:00',
      }),
    );

    expect(titles(await dashboard(agent))).toEqual(['Del periodo actual']);
    await agent.patch(`/api/periods/${other.id}`).send({ isCurrent: true }).expect(200);
    expect(titles(await dashboard(agent))).toEqual(['De otro periodo']);
  });

  it('never shows another user’s classes', async () => {
    const a = await setupJune('a@example.com');
    const b = await setupJune('b@example.com', 'Materia B');
    await post(a.agent, block(a.subject.id, { title: 'Clase de A' }));
    await post(b.agent, block(b.subject.id, { title: 'Clase de B' }));
    expect(titles(await dashboard(a.agent))).toEqual(['Clase de A']);
    expect(JSON.stringify(await dashboard(a.agent))).not.toContain('Clase de B');
  });

  describe('"today" is the user’s local day, not the UTC day', () => {
    it('America/Los_Angeles: at 03:00Z on 2 June it is still the evening of Monday 1 June', async () => {
      const { agent, user, subject } = await setupJune('la@example.com');
      await prisma.user.update({
        where: { id: user.id },
        data: { timezone: 'America/Los_Angeles' },
      });
      now = new Date('2026-06-02T03:00:00.000Z');

      await post(
        agent,
        block(subject.id, {
          title: 'Hoy en LA',
          date: '2026-06-01',
          startTime: '08:00',
          endTime: '09:00',
        }),
      ); // 15:00Z on the 1st
      await post(
        agent,
        block(subject.id, {
          title: 'Mañana en LA',
          date: '2026-06-02',
          startTime: '08:00',
          endTime: '09:00',
        }),
      );
      const d = await dashboard(agent);
      expect(d.localDate).toBe('2026-06-01');
      expect(titles(d)).toEqual(['Hoy en LA']);
    });

    it('Asia/Tokyo: at 20:00Z on 1 June it is already Tuesday 2 June for the user', async () => {
      const { agent, user, subject } = await setupJune('tokyo@example.com');
      await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Asia/Tokyo' } });
      now = new Date('2026-06-01T20:00:00.000Z');

      await post(
        agent,
        block(subject.id, {
          title: 'Ayer en Tokio',
          date: '2026-06-01',
          startTime: '08:00',
          endTime: '09:00',
        }),
      );
      await post(
        agent,
        block(subject.id, {
          title: 'Hoy en Tokio',
          date: '2026-06-02',
          startTime: '08:00',
          endTime: '09:00',
        }),
      );
      const d = await dashboard(agent);
      expect(d.localDate).toBe('2026-06-02');
      expect(titles(d)).toEqual(['Hoy en Tokio']);
    });

    it('a weekly class keeps its local hour on today’s entry across a daylight-saving change', async () => {
      const { agent, user } = await setupJune('ny@example.com');
      await prisma.user.update({ where: { id: user.id }, data: { timezone: 'America/New_York' } });
      now = new Date('2026-03-10T15:00:00.000Z'); // Tuesday 10 March, just after the clocks moved forward
      const ny = (
        await agent
          .post('/api/periods')
          .send({ name: 'NY', startDate: '2026-01-05', endDate: '2026-06-26', isCurrent: true })
      ).body.period;
      const subject = (await agent.post('/api/subjects').send({ periodId: ny.id, name: 'Física' }))
        .body.subject;
      await post(
        agent,
        block(subject.id, {
          title: 'Física',
          date: '2026-01-06',
          startTime: '08:00',
          endTime: '09:00',
          recurrence: { frequency: 'WEEKLY', until: '2026-06-23' },
        }),
      );

      const [today] = (await dashboard(agent)).classesToday;
      expect(today).toMatchObject({
        occurrenceDate: '2026-03-10',
        startAt: '2026-03-10T12:00:00.000Z',
      }); // 08:00 EDT
    });
  });
});
