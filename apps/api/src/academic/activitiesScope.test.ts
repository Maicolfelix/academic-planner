import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

// "Now" is controlled: 12:00 on Monday 5 October 2026 in Bogotá.
const NOW = new Date('2026-10-05T17:00:00.000Z');
const app: Express = buildApp({ clock: () => NOW });
beforeEach(resetDb);
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
  ).body.period as { id: string };
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
const listed = async (a: Agent, qs = 'scope=current') =>
  (await a.get(`/api/activities?${qs}`).expect(200)).body.activities as {
    id: string;
    title: string;
    periodId: string;
  }[];
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

/** General (HOME) + Medicina (primary) + Diplomado, a PAST period of Medicina and an ARCHIVED study, each with activities. */
async function world(agent: Agent) {
  const G = await period(agent, { name: 'General' });
  const medicina = await track(agent, 'Medicina');
  const diploma = await track(agent, 'Diplomado', 'OTHER_ACADEMIC');
  const viejo = await track(agent, 'Viejo', 'SCHOOL');
  const M = await period(agent, { studyTrackId: medicina.id });
  const D = await period(agent, { studyTrackId: diploma.id });
  const H = await period(agent, { studyTrackId: medicina.id }); // past: not current
  const V = await period(agent, { studyTrackId: viejo.id });
  const sg = await subject(agent, G.id, 'Tareas');
  const sm = await subject(agent, M.id, 'Farmacología');
  const sd = await subject(agent, D.id, 'Redes');
  const sh = await subject(agent, H.id, 'Vieja');
  const sv = await subject(agent, V.id, 'Antigua');
  const a = {
    general: await activity(agent, { title: 'General suelta', dueDate: '2026-10-07' }),
    generalS: await activity(agent, {
      subjectId: sg.id,
      title: 'General con asignatura',
      dueDate: '2026-10-07',
    }),
    med1: await activity(agent, {
      subjectId: sm.id,
      title: 'Med uno',
      type: 'EXAM',
      priority: 'HIGH',
      dueDate: '2026-10-06',
    }),
    med2: await activity(agent, {
      subjectId: sm.id,
      title: 'Med dos vencida',
      dueDate: '2026-09-30',
    }),
    dip1: await activity(agent, { subjectId: sd.id, title: 'Dip uno', dueDate: '2026-10-08' }),
    dip2: await activity(agent, {
      subjectId: sd.id,
      title: 'Dip dos hecha',
      dueDate: '2026-10-09',
    }),
    hist: await activity(agent, { subjectId: sh.id, title: 'Histórica', dueDate: '2026-10-06' }),
    arch: await activity(agent, { subjectId: sv.id, title: 'Archivada', dueDate: '2026-10-06' }),
  };
  await agent.patch(`/api/activities/${a.dip2.id}`).send({ status: 'COMPLETED' }).expect(200);
  await agent.post(`/api/study-tracks/${viejo.id}/archive`).expect(200);
  return { G, M, D, H, V, medicina, diploma, viejo, a, sg, sm, sd, sh };
}

describe('GET /api/activities?scope=current: ALL the current, active periods', () => {
  it('a general period and two studies: everything of the three, nothing of a past period or an archived study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await world(agent);
    expect(titles(await listed(agent))).toEqual(
      [
        'Dip dos hecha',
        'Dip uno',
        'General con asignatura',
        'General suelta',
        'Med dos vencida',
        'Med uno',
      ].sort(),
    );
  });

  it('each activity says its own period (read-only), which is how a screen finds its study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const byTitle = new Map((await listed(agent)).map((x) => [x.title, x.periodId]));
    expect(byTitle.get('Med uno')).toBe(w.M.id);
    expect(byTitle.get('Dip uno')).toBe(w.D.id);
    expect(byTitle.get('General suelta')).toBe(w.G.id);
  });

  it('without a scope it is what it always was: every activity of the user (or of the period asked)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    expect(await listed(agent, '')).toHaveLength(8);
    expect(titles(await listed(agent, `periodId=${w.H.id}`))).toEqual(['Histórica']);
  });

  it('an archived study leaves the scope, and so does a study that is restored but has no current period', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    await agent.post(`/api/study-tracks/${w.diploma.id}/archive`).expect(200);
    expect(titles(await listed(agent))).toEqual([
      'General con asignatura',
      'General suelta',
      'Med dos vencida',
      'Med uno',
    ]);
    await agent.post(`/api/study-tracks/${w.diploma.id}/restore`).expect(200); // restoring turns no period back on
    expect(titles(await listed(agent))).not.toContain('Dip uno');
    // the history is still there when asked for by period
    expect(titles(await listed(agent, `periodId=${w.D.id}`))).toEqual(['Dip dos hecha', 'Dip uno']);
  });

  it('with no current period there is nothing to list (200, empty), even if activities exist elsewhere', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    expect(await listed(agent)).toEqual([]);
    const w = await world(agent);
    await agent.post(`/api/study-tracks/${w.medicina.id}/make-primary`).expect(200);
    const none = await signUp(app, 'b@example.com');
    expect(await listed(none.agent)).toEqual([]);
  });

  it('the filters combine with the scope exactly as they did with a period', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    expect(titles(await listed(agent, 'scope=current&status=COMPLETED'))).toEqual([
      'Dip dos hecha',
    ]);
    expect(titles(await listed(agent, 'scope=current&status=PENDING'))).toEqual(
      ['Dip uno', 'General con asignatura', 'General suelta', 'Med dos vencida', 'Med uno'].sort(),
    );
    expect(titles(await listed(agent, 'scope=current&overdue=true'))).toEqual(['Med dos vencida']);
    expect(titles(await listed(agent, `scope=current&subjectId=${w.sd.id}`))).toEqual([
      'Dip dos hecha',
      'Dip uno',
    ]);
    expect(titles(await listed(agent, 'scope=current&subjectId=none'))).toEqual(['General suelta']);
    expect(titles(await listed(agent, 'scope=current&type=EXAM'))).toEqual(['Med uno']);
    expect(titles(await listed(agent, 'scope=current&priority=HIGH'))).toEqual(['Med uno']);
    expect(titles(await listed(agent, 'scope=current&from=2026-10-08&to=2026-10-09'))).toEqual([
      'Dip dos hecha',
      'Dip uno',
    ]);
    // the order is the one it always was: soonest deadline first, whatever the study
    const dues = (await listed(agent)).map((x) => x.title);
    expect(dues).toEqual([
      'Med dos vencida',
      'Med uno',
      'General suelta', // same deadline as the next one: the older first
      'General con asignatura',
      'Dip uno',
      'Dip dos hecha',
    ]);
  });

  it('the Dashboard counters and this list are the SAME scope: the counts agree', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await world(agent);
    const d = (await agent.get('/api/dashboard').expect(200)).body.dashboard;
    const all = await listed(agent);
    expect(all).toHaveLength(d.summary.total);
    const pending = await listed(agent, 'scope=current&status=PENDING');
    expect(pending).toHaveLength(d.summary.pending);
    expect(await listed(agent, 'scope=current&status=COMPLETED')).toHaveLength(d.summary.completed);
    expect(await listed(agent, 'scope=current&overdue=true')).toHaveLength(d.summary.overdue);
  });
});

describe('the scope is the server’s: a client can neither widen it nor name another user', () => {
  it('a period sent with the scope only narrows it; other parameters and unknown scopes are refused or ignored', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    // the past period is not in the scope, so naming it with the scope finds nothing (it never adds it)
    expect(await listed(agent, `scope=current&periodId=${w.H.id}`)).toEqual([]);
    expect(await listed(agent, `scope=current&periodId=${w.V.id}`)).toEqual([]);
    expect(titles(await listed(agent, `scope=current&periodId=${w.M.id}`))).toEqual([
      'Med dos vencida',
      'Med uno',
    ]);
    // a list of ids has no meaning: it is ignored and the scope stays the server's
    expect(await listed(agent, `scope=current&periodIds=${w.H.id},${w.V.id}`)).toHaveLength(6);
    expect((await agent.get('/api/activities?scope=all')).status).toBe(400);
    expect((await agent.get('/api/activities?scope=')).status).toBe(400);
  });

  it('nothing of another user is ever listed, with or without a user id in the query', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await world(b.agent);
    expect(await listed(a.agent)).toEqual([]);
    const gp = await period(a.agent);
    const s = await subject(a.agent, gp.id, 'Mía');
    await activity(a.agent, { subjectId: s.id, title: 'Mía', dueDate: '2026-10-07' });
    expect(titles(await listed(a.agent, `scope=current&userId=${b.user.id}`))).toEqual(['Mía']);
    expect(titles(await listed(a.agent, 'scope=current'))).toEqual(['Mía']);
  });

  it('it is a private read: no-store, and it writes nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await world(agent);
    const before = JSON.stringify(await prisma.activity.findMany({ orderBy: { id: 'asc' } }));
    const res = await agent.get('/api/activities?scope=current').expect(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(JSON.stringify(await prisma.activity.findMany({ orderBy: { id: 'asc' } }))).toBe(before);
  });
});

describe('GET /api/subjects?scope=current: the subjects of every current period, in one request', () => {
  it('includes the general period and both studies, excludes a past period and an archived study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const rows = (await agent.get('/api/subjects?scope=current').expect(200)).body.subjects as {
      name: string;
      periodId: string;
    }[];
    expect(rows.map((r) => r.name).sort()).toEqual(['Farmacología', 'Redes', 'Tareas']);
    expect(new Set(rows.map((r) => r.periodId))).toEqual(new Set([w.G.id, w.M.id, w.D.id]));
    // the subject keeps exposing its period (and still no study)
    expect(JSON.stringify(rows)).not.toContain('studyTrack');
  });

  it('is scoped by the session, ignores a period list, refuses an unknown scope, and without a scope is unchanged', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await world(b.agent);
    const w = await world(a.agent);
    const names = async (qs: string) =>
      ((await a.agent.get(`/api/subjects?${qs}`).expect(200)).body.subjects as { name: string }[])
        .map((s) => s.name)
        .sort();
    expect(await names('scope=current')).toEqual(['Farmacología', 'Redes', 'Tareas']);
    expect(await names(`scope=current&periodIds=${w.H.id}&userId=${b.user.id}`)).toEqual([
      'Farmacología',
      'Redes',
      'Tareas',
    ]);
    expect(await names(`periodId=${w.H.id}`)).toEqual(['Vieja']);
    expect(await names('')).toHaveLength(5);
    expect((await a.agent.get('/api/subjects?scope=all')).status).toBe(400);
    // a period OR the scope, never both: nothing valid is silently ignored (Activities, on purpose, do let a period narrow)
    const both = await a.agent.get(`/api/subjects?scope=current&periodId=${w.H.id}`);
    expect(both.status).toBe(400);
    expect(both.body.error.code).toBe('VALIDATION_ERROR');
    expect((await signUp(app, 'c@example.com')).agent).toBeDefined();
  });
});

describe('writing stays HOME; an activity of another study is editable by id without moving period', () => {
  it('a new general activity goes to HOME, whatever the list shows', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    await listed(agent);
    const created = await activity(agent, { title: 'Nueva sin asignatura', dueDate: '2026-10-07' });
    expect(created.periodId).toBe(w.G.id); // HOME = the general current period
    expect(titles(await listed(agent))).toContain('Nueva sin asignatura');
  });

  it('edit, change status and delete an activity of the secondary study through its id; its period never changes', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const w = await world(agent);
    const id = w.a.dip1.id;
    const edited = await agent
      .patch(`/api/activities/${id}`)
      .send({ title: 'Dip editada', status: 'IN_PROGRESS' })
      .expect(200);
    expect(edited.body.activity).toMatchObject({
      title: 'Dip editada',
      status: 'IN_PROGRESS',
      periodId: w.D.id,
    });
    // its subject can only be one of ITS period: a subject of the home period is refused and nothing changes
    const refused = await agent.patch(`/api/activities/${id}`).send({ subjectId: w.sg.id });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).periodId).toBe(w.D.id);
    // a period can never be sent
    expect((await agent.patch(`/api/activities/${id}`).send({ periodId: w.G.id })).status).toBe(
      400,
    );
    await agent.delete(`/api/activities/${id}`).expect(204);
    expect(titles(await listed(agent))).not.toContain('Dip editada');
  });

  it('another user cannot reach it by id (the same 404 as one that does not exist)', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const w = await world(a.agent);
    const foreign = await b.agent.patch(`/api/activities/${w.a.dip1.id}`).send({ title: 'X' });
    const missing = await b.agent.patch(`/api/activities/${randomUUID()}`).send({ title: 'X' });
    expect(foreign.status).toBe(404);
    expect({ status: foreign.status, body: foreign.body }).toEqual({
      status: missing.status,
      body: missing.body,
    });
  });
});
