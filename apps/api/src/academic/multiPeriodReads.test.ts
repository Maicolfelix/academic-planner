import { PrismaPg } from '@prisma/adapter-pg';
import {
  ATTENTION_ALTERNATIVES_LIMIT,
  currentPeriodsResponseSchema,
  dashboardResponseSchema,
  progressResponseSchema,
  radarResponseSchema,
  workloadResponseSchema,
} from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

// "Now" is controlled: 12:00 on Monday 5 October 2026 in Bogotá (UTC-5).
const NOW = new Date('2026-10-05T17:00:00.000Z');
// Things are CREATED a few days earlier (so their automatic reminders are still in the future then) and READ at NOW.
const EARLIER = new Date('2026-10-01T17:00:00.000Z');
let clock = NOW;
const app = buildApp({ clock: () => clock });
beforeEach(async () => {
  clock = NOW;
  await resetDb();
});
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
let seq = 0;

const track = async (a: Agent, name: string, type = 'UNIVERSITY') =>
  (await a.post('/api/study-tracks').send({ name, type }).expect(201)).body.studyTrack as {
    id: string;
  };
const period = async (a: Agent, body: object = {}) =>
  (
    await a
      .post('/api/periods')
      .send({ ...periodInput, name: `P${(seq += 1)}`, ...body })
      .expect(201)
  ).body.period as { id: string; isCurrent: boolean };
const subject = async (a: Agent, periodId: string, name: string) =>
  (await a.post('/api/subjects').send({ periodId, name }).expect(201)).body.subject as {
    id: string;
  };
const activity = async (a: Agent, body: object) =>
  (
    await a
      .post('/api/activities')
      .send({ type: 'TASK', ...body })
      .expect(201)
  ).body.activity as {
    id: string;
    periodId: string;
  };
const done = (a: Agent, id: string) =>
  a.patch(`/api/activities/${id}`).send({ status: 'COMPLETED' }).expect(200);
const classIn = (
  a: Agent,
  periodId: string,
  subjectId: string,
  title: string,
  date: string,
  start: string,
  end: string,
) =>
  a
    .post('/api/schedule')
    .send({ type: 'CLASS', periodId, subjectId, title, date, startTime: start, endTime: end })
    .expect(201);

const strip = (body: unknown) =>
  JSON.parse(JSON.stringify(body, (k, v) => (k === 'generatedAt' ? undefined : v)));

/**
 * A user with: a general current period (G), Medicina (the primary study) and Diplomado (secondary) each with a current period
 * (M, D), a PAST period of Medicina (H, not current) and an archived study (V). Every one has subjects and activities.
 */
async function world(agent: Agent) {
  clock = EARLIER;
  const G = await period(agent, { name: 'General' });
  const medicina = await track(agent, 'Medicina');
  const diploma = await track(agent, 'Diplomado en Ciberseguridad', 'OTHER_ACADEMIC');
  const viejo = await track(agent, 'Viejo', 'SCHOOL');
  const M = await period(agent, { name: '2026-2', studyTrackId: medicina.id });
  const D = await period(agent, { name: 'Cohorte oct–dic', studyTrackId: diploma.id });
  const H = await period(agent, { name: '2026-1', studyTrackId: medicina.id }); // past: not current
  const V = await period(agent, { name: 'Viejo actual', studyTrackId: viejo.id });
  expect([G.isCurrent, M.isCurrent, D.isCurrent, H.isCurrent, V.isCurrent]).toEqual([
    true,
    true,
    true,
    false,
    true,
  ]);

  const tareas = await subject(agent, G.id, 'Tareas');
  const farma = await subject(agent, M.id, 'Farmacología');
  const redes = await subject(agent, D.id, 'Redes');
  const vieja = await subject(agent, H.id, 'Anatomía vieja');
  const antigua = await subject(agent, V.id, 'Antigua');

  const a = {
    gA: await activity(agent, { title: 'Trámite general', dueDate: '2026-10-07' }), // no subject: goes to HOME (G)
    mA: await activity(agent, {
      subjectId: farma.id,
      title: 'Parcial Farmacología',
      type: 'EXAM',
      dueDate: '2026-10-06',
      dueTime: '10:00',
    }),
    mB: await activity(agent, {
      subjectId: farma.id,
      title: 'Taller vencido M',
      dueDate: '2026-09-30',
    }),
    dA: await activity(agent, {
      subjectId: redes.id,
      title: 'Laboratorio Redes',
      dueDate: '2026-10-08',
    }),
    dB: await activity(agent, {
      subjectId: redes.id,
      title: 'Entrega hecha',
      dueDate: '2026-10-09',
    }),
    dX: await activity(agent, { subjectId: redes.id, title: 'Vencida D', dueDate: '2026-09-25' }),
    dE: await activity(agent, {
      subjectId: redes.id,
      title: 'Examen Redes',
      type: 'EXAM',
      dueDate: '2026-10-06',
      dueTime: '10:00',
    }),
    hA: await activity(agent, {
      subjectId: vieja.id,
      title: 'Examen histórico',
      type: 'EXAM',
      dueDate: '2026-10-06',
      dueTime: '10:00',
    }),
    vA: await activity(agent, {
      subjectId: antigua.id,
      title: 'Examen archivado',
      type: 'EXAM',
      dueDate: '2026-10-06',
      dueTime: '10:00',
    }),
  };
  await done(agent, a.dB.id);
  await classIn(agent, M.id, farma.id, 'Clase Farmacología', '2026-10-05', '08:00', '10:00');
  await classIn(agent, D.id, redes.id, 'Clase Redes', '2026-10-06', '14:00', '16:00');
  await classIn(agent, H.id, vieja.id, 'Clase histórica', '2026-10-07', '08:00', '10:00');
  await agent.post(`/api/study-tracks/${viejo.id}/archive`).expect(200); // V is no longer current
  clock = NOW;
  return { G, M, D, H, V, medicina, diploma, viejo, a, subjects: { tareas, farma, redes } };
}

const dashboard = async (a: Agent) =>
  dashboardResponseSchema.parse((await a.get('/api/dashboard').expect(200)).body).dashboard;

describe('Dashboard: ALL the current, active periods, with HOME kept', () => {
  it('adds up the general period and both active studies, and nothing from a past period or an archived study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const d = await dashboard(agent);
    // gA, mA, mB, dA, dB, dX, dE: seven (hA is a past period's, vA an archived study's)
    expect(d.summary).toMatchObject({
      total: 7,
      completed: 1,
      pending: 6,
      inProgress: 0,
      overdue: 2,
    });
    expect(d.progress).toMatchObject({ completed: 1, total: 7 });
    expect(d.subjectCount).toBe(3); // Tareas, Farmacología, Redes
    // HOME is kept: the general current period
    expect(d.period?.id).toBe(w.G.id);
    expect(d.periods.map((c) => c.period.id)).toEqual([w.G.id, w.M.id, w.D.id]); // general, primary, the rest
    expect(d.periods.map((c) => c.studyTrack?.name ?? null)).toEqual([
      null,
      'Medicina',
      'Diplomado en Ciberseguridad',
    ]);
    expect(d.periods.map((c) => c.studyTrack?.isPrimary ?? null)).toEqual([null, true, false]);
  });

  it('the lists mix the studies, with the same order, limits and statuses as before', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const d = await dashboard(agent);
    expect(d.overdue.map((x) => x.title)).toEqual(['Vencida D', 'Taller vencido M']); // most overdue first, whatever the study
    expect(d.upcoming.map((x) => x.title)).toEqual([
      'Parcial Farmacología',
      'Examen Redes',
      'Trámite general',
      'Laboratorio Redes',
    ]);
    expect(d.nextDue?.title).toBe('Parcial Farmacología');
    expect(d.today).toEqual([]);
    expect(d.classesToday.map((c) => c.title)).toEqual(['Clase Farmacología']);
    // every item says which period it belongs to (that is how a screen finds its study)
    const periodOf = new Map([...d.overdue, ...d.upcoming].map((x) => [x.title, x.periodId]));
    expect(periodOf.get('Vencida D')).toBe(w.D.id);
    expect(periodOf.get('Taller vencido M')).toBe(w.M.id);
    expect(periodOf.get('Trámite general')).toBe(w.G.id);
  });

  it('no activity is counted twice: an activity with a subject counts once, by the period it stores', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const d = await dashboard(agent);
    const stored = await prisma.activity.count({
      where: { periodId: { in: [w.G.id, w.M.id, w.D.id] } },
    });
    expect(d.summary.total).toBe(stored);
  });

  it('the descriptor of a study says only what labels need (no owner, status or program key)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await world(agent);
    const d = await dashboard(agent);
    expect(Object.keys(d.periods[1]!.studyTrack!).sort()).toEqual([
      'id',
      'isPrimary',
      'name',
      'type',
    ]);
    expect(JSON.stringify(d)).not.toMatch(/userId|programKey|ARCHIVED/);
  });

  it('archiving a study takes its data out of the summaries; the history is not deleted', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    await agent.post(`/api/study-tracks/${w.diploma.id}/archive`).expect(200);
    const d = await dashboard(agent);
    expect(d.summary.total).toBe(3); // gA, mA, mB
    expect(d.periods.map((c) => c.period.id)).toEqual([w.G.id, w.M.id]);
    expect(d.subjectCount).toBe(2);
    expect(d.overdue.map((x) => x.title)).toEqual(['Taller vencido M']);
    expect(await prisma.activity.count({ where: { periodId: w.D.id } })).toBe(4); // still there
  });

  it('an archived study’s period is not read even if its current flag survived by force (the study decides, not the flag)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent); // V belongs to an archived study
    await prisma.academicPeriod.update({ where: { id: w.V.id }, data: { isCurrent: true } });
    const d = await dashboard(agent);
    expect(d.summary.total).toBe(7);
    expect(d.periods.map((c) => c.period.id)).toEqual([w.G.id, w.M.id, w.D.id]);
    const radar = radarResponseSchema.parse((await agent.get('/api/radar').expect(200)).body).radar;
    expect(
      Object.values(radar.groups)
        .flat()
        .map((x) => x.id),
    ).not.toContain(w.a.vA.id);
    const due = (await agent.get('/api/reminders/due').expect(200)).body.reminders as {
      activity: { id: string };
    }[];
    expect(due.map((r) => r.activity.id)).not.toContain(w.a.vA.id);
  });

  it('a legacy account (one general current period) sees exactly its own, with one descriptor', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const only = await period(agent);
    const s = await subject(agent, only.id, 'Redes');
    await activity(agent, { subjectId: s.id, title: 'Tarea', dueDate: '2026-10-07' });
    const d = await dashboard(agent);
    expect(d.period?.id).toBe(only.id);
    expect(d.periods).toHaveLength(1);
    expect(d.periods[0]!.studyTrack).toBeNull();
    expect(d.summary.total).toBe(1);
    expect(d.subjectCount).toBe(1);
  });

  it('empty states: only a primary study current; only a SECONDARY one (no HOME, data still read); studies without a current period', async () => {
    // only the primary study has a current period: HOME is that one
    const a = await signUp(app, 'a@example.com');
    const medicina = await track(a.agent, 'Medicina');
    const pm = await period(a.agent, { studyTrackId: medicina.id });
    const dm = await dashboard(a.agent);
    expect([dm.period?.id, dm.periods.map((c) => c.period.id)]).toEqual([pm.id, [pm.id]]);

    // only a secondary study has a current period: no HOME, but the API reads it
    const b = await signUp(app, 'b@example.com');
    await track(b.agent, 'Primero'); // primary, without a current period
    const second = await track(b.agent, 'Segundo', 'OTHER_ACADEMIC');
    const ps = await period(b.agent, { studyTrackId: second.id });
    const s = await subject(b.agent, ps.id, 'Materia');
    await activity(b.agent, { subjectId: s.id, title: 'Algo', dueDate: '2026-10-07' });
    const dsec = await dashboard(b.agent);
    expect(dsec.period).toBeNull();
    expect(dsec.periods.map((c) => c.period.id)).toEqual([ps.id]);
    expect(dsec.summary.total).toBe(1);

    // studies but no current period at all
    const c = await signUp(app, 'c@example.com');
    await track(c.agent, 'Sin periodo');
    const dn = await dashboard(c.agent);
    expect([dn.period, dn.periods, dn.summary.total, dn.subjectCount]).toEqual([null, [], 0, 0]);
  });
});

describe('Radar and Attention: every activity of every current period, no study first', () => {
  it('the Radar reads all of them and orders as before: the most overdue first, whatever its study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const radar = radarResponseSchema.parse((await agent.get('/api/radar').expect(200)).body).radar;
    const open = Object.values(radar.summary).reduce((n, v) => n + v, 0);
    expect(open).toBe(6); // gA, mA, mB, dA, dX, dE (dB is done; hA and vA are not current)
    const ids = Object.values(radar.groups)
      .flat()
      .map((x) => x.id);
    expect(ids).not.toContain(w.a.hA.id);
    expect(ids).not.toContain(w.a.vA.id);
    expect(ids).toContain(w.a.dE.id);
    // the secondary study's activity is the most overdue: it comes first (the primary study has no priority)
    expect(radar.groups.overdue.map((x) => x.title)).toEqual(['Vencida D', 'Taller vencido M']);
    expect(radar.period?.id).toBe(w.G.id);
    expect(radar.periods.map((c) => c.period.id)).toEqual([w.G.id, w.M.id, w.D.id]);
  });

  it('an archived study leaves the Radar', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    await agent.post(`/api/study-tracks/${w.diploma.id}/archive`).expect(200);
    const radar = radarResponseSchema.parse((await agent.get('/api/radar').expect(200)).body).radar;
    expect(Object.values(radar.summary).reduce((n, v) => n + v, 0)).toBe(3);
    expect(radar.periods).toHaveLength(2);
  });

  it('Attention considers all of them: activities of both studies are offered, never a past or archived period’s', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const att = (await agent.get('/api/attention').expect(200)).body.attention;
    const offered = [att.recommendation, ...att.alternatives, ...att.upcoming]
      .filter(Boolean)
      .map((i: { activity: { id: string; periodId: string } }) => i.activity);
    const periodsOffered = new Set(offered.map((x: { periodId: string }) => x.periodId));
    expect(periodsOffered.has(w.M.id)).toBe(true);
    expect(periodsOffered.has(w.D.id)).toBe(true);
    const ids = offered.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(w.a.hA.id);
    expect(ids).not.toContain(w.a.vA.id);
    expect(att.alternatives.length).toBeLessThanOrEqual(ATTENTION_ALTERNATIVES_LIMIT); // the limit is unchanged
    expect(att.period.id).toBe(w.G.id);
    expect(att.periods.map((c: { period: { id: string } }) => c.period.id)).toEqual([
      w.G.id,
      w.M.id,
      w.D.id,
    ]);
  });
});

describe('Progress: overall and by period, never one mixed semester', () => {
  it('overall counts every current period; byPeriod splits it; zero-activity periods appear with zeros; subjects know their period', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const p = progressResponseSchema.parse(
      (await agent.get('/api/progress').expect(200)).body,
    ).progress;
    expect(p.general).toMatchObject({ total: 7, completed: 1, overdue: 2 });
    const by = new Map(p.byPeriod.map((x) => [x.period.id, x]));
    expect(p.byPeriod.map((x) => x.period.id)).toEqual([w.G.id, w.M.id, w.D.id]);
    expect(by.get(w.G.id)!.general).toMatchObject({ total: 1, completed: 0, overdue: 0 });
    expect(by.get(w.M.id)!.general).toMatchObject({ total: 2, completed: 0, overdue: 1 });
    expect(by.get(w.D.id)!.general).toMatchObject({ total: 4, completed: 1, overdue: 1 });
    // the parts add up to the whole
    expect([...by.values()].reduce((n, x) => n + x.general.total, 0)).toBe(p.general.total);
    // subjects: alphabetical, with their period; the empty one is there, the past and archived ones are not
    expect(p.subjects.map((s) => [s.name, s.periodId, s.total])).toEqual([
      ['Farmacología', w.M.id, 2],
      ['Redes', w.D.id, 4],
      ['Tareas', w.G.id, 0],
    ]);
    expect(p.period?.id).toBe(w.G.id);
  });

  it('a current period with no activity at all is one entry of zeros (not an error)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const only = await period(agent);
    const p = progressResponseSchema.parse(
      (await agent.get('/api/progress').expect(200)).body,
    ).progress;
    expect(p.general).toMatchObject({ total: 0, completed: 0, overdue: 0, percentage: 0 });
    expect(p.byPeriod).toHaveLength(1);
    expect(p.byPeriod[0]!.period.id).toBe(only.id);
    expect(p.subjects).toEqual([]);
  });

  it('with no current period there is nothing to read; an archived study leaves the progress', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const none = progressResponseSchema.parse(
      (await agent.get('/api/progress').expect(200)).body,
    ).progress;
    expect([none.period, none.byPeriod, none.subjects]).toEqual([null, [], []]);
    const w = await world(agent);
    await agent.post(`/api/study-tracks/${w.diploma.id}/archive`).expect(200);
    const p = progressResponseSchema.parse(
      (await agent.get('/api/progress').expect(200)).body,
    ).progress;
    expect(p.general.total).toBe(3);
    expect(p.byPeriod.map((x) => x.period.id)).toEqual([w.G.id, w.M.id]);
  });
});

describe('Workload, reminders and the Agenda', () => {
  it('the week adds up all the current periods and no history', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const wl = workloadResponseSchema.parse(
      (await agent.get('/api/workload?week=2026-10-05').expect(200)).body,
    ).workload;
    // due this week: gA (7), mA (6), dE (6), dA (8), dB (9, done); hA and vA are not current
    expect(wl.totals).toMatchObject({
      activityCount: 5,
      openActivityCount: 4,
      classCount: 2,
      scheduleOccurrenceCount: 2,
    });
    expect(wl.period?.id).toBe(w.G.id);
    expect(wl.periods).toHaveLength(3);
  });

  it('reminders follow their ACTIVITY: due ones of every current period, none of a past period or an archived study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const due = (await agent.get('/api/reminders/due').expect(200)).body as {
      reminders: { activity: { id: string; periodId: string } }[];
      total: number;
    };
    const ids = new Set(due.reminders.map((r) => r.activity.id));
    expect(ids.has(w.a.mA.id)).toBe(true); // Medicina
    expect(ids.has(w.a.dE.id)).toBe(true); // Diplomado
    expect(ids.has(w.a.hA.id)).toBe(false); // a past period of Medicina
    expect(ids.has(w.a.vA.id)).toBe(false); // an archived study
    const byId = new Map(due.reminders.map((r) => [r.activity.id, r.activity.periodId]));
    expect(byId.get(w.a.mA.id)).toBe(w.M.id);
    expect(byId.get(w.a.dE.id)).toBe(w.D.id);
    expect(due.total).toBeGreaterThanOrEqual(due.reminders.length);
    // archiving the study removes its reminders from the due list (they are kept, not deleted)
    await agent.post(`/api/study-tracks/${w.diploma.id}/archive`).expect(200);
    const after = (await agent.get('/api/reminders/due').expect(200)).body.reminders as {
      activity: { id: string };
    }[];
    expect(after.map((r) => r.activity.id)).not.toContain(w.a.dE.id);
    expect(await prisma.reminder.count({ where: { activityId: w.a.dE.id } })).toBeGreaterThan(0);
  });

  it('the Agenda stays global: classes and activities of every period, current or not, archived or not', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    await agent.post(`/api/study-tracks/${w.diploma.id}/archive`).expect(200);
    const week = (await agent.get('/api/schedule?from=2026-10-05&to=2026-10-11').expect(200)).body
      .occurrences as {
      title: string;
      periodId: string;
    }[];
    expect(week.map((o) => o.title).sort()).toEqual([
      'Clase Farmacología',
      'Clase Redes',
      'Clase histórica',
    ]);
    expect(new Set(week.map((o) => o.periodId))).toEqual(new Set([w.M.id, w.D.id, w.H.id]));
    const acts = (await agent.get('/api/activities?from=2026-10-05&to=2026-10-11').expect(200)).body
      .activities as {
      id: string;
      periodId: string;
    }[];
    const ids = acts.map((x) => x.id);
    for (const x of [w.a.hA, w.a.vA, w.a.dE, w.a.mA]) expect(ids).toContain(x.id);
    expect(acts.find((x) => x.id === w.a.hA.id)!.periodId).toBe(w.H.id);
  });
});

describe('GET /api/periods/current and the HOME rule inside the list', () => {
  it('lists every current, active period with its study, in the fixed order, and it equals the Dashboard’s', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const res = await agent.get('/api/periods/current').expect(200);
    const parsed = currentPeriodsResponseSchema.parse(res.body);
    expect(parsed.periods.map((c) => c.period.id)).toEqual([w.G.id, w.M.id, w.D.id]);
    expect(parsed.periods).toEqual((await dashboard(agent)).periods);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('needs a session; "current" is not read as a period id', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    expect((await agent.get('/api/periods/current')).body).toEqual({ periods: [] });
    const anonymous = await request(app).get('/api/periods/current');
    expect(anonymous.status).toBe(401);
  });

  it('the HOME period read out of the list is the one GET /api/periods/home decides, in every state', async () => {
    const homeOf = async (a: Agent) =>
      (await a.get('/api/periods/home').expect(200)).body.period?.id ?? null;
    const viaDashboard = async (a: Agent) => (await dashboard(a)).period?.id ?? null;
    const states: ((a: Agent) => Promise<void>)[] = [
      async () => {}, // nothing at all
      async (a) => void (await period(a)), // a general period only
      async (a) => {
        const t = await track(a, 'P'); // primary with a current period, no general
        await period(a, { studyTrackId: t.id });
      },
      async (a) => {
        await track(a, 'Primero'); // primary without a current period, a secondary with one
        const t = await track(a, 'Segundo', 'SCHOOL');
        await period(a, { studyTrackId: t.id });
      },
      async (a) => {
        await period(a); // general + primary + secondary
        const t1 = await track(a, 'A');
        const t2 = await track(a, 'B', 'SCHOOL');
        await period(a, { studyTrackId: t1.id });
        await period(a, { studyTrackId: t2.id });
      },
    ];
    for (const [i, setup] of states.entries()) {
      const { agent } = await signUp(app, `state${i}@example.com`);
      await setup(agent);
      expect(await viaDashboard(agent), `state ${i}`).toBe(await homeOf(agent));
    }
  });
});

describe('security: the scope is the server’s, never the client’s', () => {
  it('nothing of another user is ever read, and a user with no current period sees none of the other’s', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await world(b.agent);
    const empty = await dashboard(a.agent);
    expect([empty.period, empty.periods, empty.summary.total]).toEqual([null, [], 0]);
    expect((await a.agent.get('/api/radar').expect(200)).body.radar.periods).toEqual([]);
    expect((await a.agent.get('/api/progress').expect(200)).body.progress.byPeriod).toEqual([]);
    expect((await a.agent.get('/api/reminders/due').expect(200)).body.total).toBe(0);
    expect(JSON.stringify((await a.agent.get('/api/periods/current')).body)).toBe('{"periods":[]}');
  });

  it('no parameter can widen or change the scope: periodIds, studyTrackIds, userId and the like are ignored', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const wa = await world(a.agent);
    const wb = await world(b.agent);
    const evil =
      `?periodId=${wa.H.id}&periodIds=${wa.H.id},${wa.V.id},${wb.M.id}` +
      `&studyTrackId=${wa.viejo.id}&studyTrackIds=${wb.medicina.id}&userId=${b.user.id}&includeArchived=true`;
    for (const path of [
      '/api/dashboard',
      '/api/radar',
      '/api/attention',
      '/api/progress',
      '/api/workload?week=2026-10-05',
      '/api/reminders/due',
      '/api/periods/current',
    ]) {
      const sep = path.includes('?') ? '&' : '?';
      const plain = await a.agent.get(path).expect(200);
      const tampered = await a.agent
        .get(path + (sep === '&' ? evil.replace('?', '&') : evil))
        .expect(200);
      expect(strip(tampered.body), path).toEqual(strip(plain.body));
      expect(JSON.stringify(tampered.body), path).not.toContain(wb.M.id);
      expect(tampered.headers['cache-control']).toMatch(/no-store/);
    }
  });

  it('the summaries are read-only: they write nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await world(agent);
    const snapshot = async () =>
      JSON.stringify([
        await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }),
        await prisma.activity.findMany({ orderBy: { id: 'asc' } }),
        await prisma.reminder.findMany({ orderBy: { id: 'asc' } }),
        await prisma.studyTrack.findMany({ orderBy: { id: 'asc' } }),
      ]);
    const before = await snapshot();
    for (const p of [
      '/api/dashboard',
      '/api/radar',
      '/api/attention',
      '/api/progress',
      '/api/workload',
      '/api/reminders/due',
      '/api/periods/current',
    ]) {
      await agent.get(p).expect(200);
    }
    expect(await snapshot()).toBe(before);
  });
});

describe('efficiency: a constant number of queries however many periods are current', () => {
  const queries: string[] = [];
  const logged = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: 'event', level: 'query' }],
  });
  logged.$on('query', (e) => queries.push(e.query));
  const loggedApp = buildApp({ prisma: logged, clock: () => NOW });
  afterAll(() => logged.$disconnect());

  const count = async (agent: Agent, path: string) => {
    queries.length = 0;
    await agent.get(path).expect(200);
    return queries.length;
  };
  const PATHS = [
    '/api/dashboard',
    '/api/radar',
    '/api/attention',
    '/api/progress',
    '/api/workload',
    '/api/reminders/due',
  ];

  it('one current period and four current periods cost the same queries on every summary', async () => {
    const { agent } = await signUp(loggedApp, 'perf@example.com');
    const only = await period(agent);
    const s = await subject(agent, only.id, 'Base');
    await activity(agent, { subjectId: s.id, title: 'Una', dueDate: '2026-10-07' });
    const single: Record<string, number> = {};
    for (const p of PATHS) single[p] = await count(agent, p);

    for (const n of ['A', 'B', 'C']) {
      const t = await track(agent, `Estudio ${n}`, 'OTHER_ACADEMIC');
      const p = await period(agent, { studyTrackId: t.id });
      const sub = await subject(agent, p.id, `Materia ${n}`);
      for (let i = 0; i < 5; i++)
        await activity(agent, { subjectId: sub.id, title: `${n}${i}`, dueDate: '2026-10-08' });
    }
    expect((await agent.get('/api/periods/current').expect(200)).body.periods).toHaveLength(4);
    for (const p of PATHS) {
      const many = await count(agent, p);
      expect(many, p).toBe(single[p]); // does not grow with the periods or the data
      expect(many, p).toBeLessThanOrEqual(10);
    }
  });
});
