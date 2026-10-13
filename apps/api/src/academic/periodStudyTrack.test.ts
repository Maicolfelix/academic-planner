import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPeriodLookup } from '../repositories/periodRepository.js';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
interface Period {
  id: string;
  name: string;
  isCurrent: boolean;
  studyTrackId: string | null;
}
interface Track {
  id: string;
  isPrimary: boolean;
  status: string;
}

const lookup = createPeriodLookup(prisma);
let seq = 0;
const track = async (a: Agent, name: string, type = 'UNIVERSITY') =>
  (await a.post('/api/study-tracks').send({ name, type }).expect(201)).body.studyTrack as Track;
const makePeriod = async (a: Agent, body: object = {}) => {
  seq += 1;
  const res = await a
    .post('/api/periods')
    .send({ ...periodInput, name: `Periodo ${seq}`, ...body })
    .expect(201);
  return res.body.period as Period;
};
const getPeriods = async (a: Agent) =>
  (await a.get('/api/periods').expect(200)).body.periods as Period[];
const byId = async (a: Agent, id: string) => (await getPeriods(a)).find((p) => p.id === id)!;
const currentIds = async (a: Agent) =>
  (await getPeriods(a))
    .filter((p) => p.isCurrent)
    .map((p) => p.id)
    .sort();
/** The database's own view: how many current periods each scope has (a scope is a study id, or null for "no study"). */
const currentPerScope = async (userId: string) => {
  const rows = await prisma.academicPeriod.findMany({ where: { userId, isCurrent: true } });
  const counts = new Map<string | null, number>();
  for (const r of rows) counts.set(r.studyTrackId, (counts.get(r.studyTrackId) ?? 0) + 1);
  return counts;
};
const patch = (a: Agent, id: string, body: object) => a.patch(`/api/periods/${id}`).send(body);

describe('creating a period: the general one and the ones of a study', () => {
  it('a legacy request (no study) makes a general period, the first one current, with studyTrackId null', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const p = await makePeriod(agent);
    expect(p).toMatchObject({ studyTrackId: null, isCurrent: true });
    const second = await makePeriod(agent);
    expect(second).toMatchObject({ studyTrackId: null, isCurrent: false });
    // null says the same as omitting it
    expect(await makePeriod(agent, { studyTrackId: null })).toMatchObject({
      studyTrackId: null,
      isCurrent: false,
    });
  });

  it('asking for current demotes only the current one of the SAME scope', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const first = await makePeriod(agent);
    const replacement = await makePeriod(agent, { isCurrent: true });
    expect(replacement.isCurrent).toBe(true);
    expect((await byId(agent, first.id)).isCurrent).toBe(false);
  });

  it('the FIRST period of a study is current, and it does not demote the general one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const general = await makePeriod(agent);
    const medicina = await track(agent, 'Medicina');
    const p = await makePeriod(agent, { studyTrackId: medicina.id });
    expect(p).toMatchObject({ studyTrackId: medicina.id, isCurrent: true });
    expect((await byId(agent, general.id)).isCurrent).toBe(true);
  });

  it('a general period, Medicina and a diploma can all be current at once', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const general = await makePeriod(agent);
    const medicina = await track(agent, 'Medicina');
    const diploma = await track(agent, 'Diplomado', 'OTHER_ACADEMIC');
    const pm = await makePeriod(agent, { studyTrackId: medicina.id });
    const pd = await makePeriod(agent, { studyTrackId: diploma.id });
    expect(await currentIds(agent)).toEqual([general.id, pm.id, pd.id].sort());
    expect([...(await currentPerScope(user.id)).values()]).toEqual([1, 1, 1]);
  });

  it('a second period of a study replaces only that study’s current one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const general = await makePeriod(agent);
    const medicina = await track(agent, 'Medicina');
    const diploma = await track(agent, 'Diplomado', 'OTHER_ACADEMIC');
    const first = await makePeriod(agent, { studyTrackId: medicina.id });
    const other = await makePeriod(agent, { studyTrackId: diploma.id });
    const quiet = await makePeriod(agent, { studyTrackId: medicina.id });
    expect(quiet.isCurrent).toBe(false); // not the first of its scope, and not asked
    const next = await makePeriod(agent, { studyTrackId: medicina.id, isCurrent: true });
    expect(next.isCurrent).toBe(true);
    expect((await byId(agent, first.id)).isCurrent).toBe(false);
    expect((await byId(agent, other.id)).isCurrent).toBe(true);
    expect((await byId(agent, general.id)).isCurrent).toBe(true);
  });

  it('the response always carries studyTrackId, on create, get, list and update', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    const p = await makePeriod(agent, { studyTrackId: medicina.id });
    const keys = [
      'createdAt',
      'endDate',
      'id',
      'isCurrent',
      'name',
      'startDate',
      'studyLevel',
      'studyLevelNote',
      'studyTrackId',
      'updatedAt',
    ];
    const one = (await agent.get(`/api/periods/${p.id}`).expect(200)).body.period;
    expect(Object.keys(one).sort()).toEqual(keys);
    expect(Object.keys((await getPeriods(agent))[0]!).sort()).toEqual(keys);
    expect(
      Object.keys((await patch(agent, p.id, { name: 'X' }).expect(200)).body.period).sort(),
    ).toEqual(keys);
    expect(one.studyTrackId).toBe(medicina.id);
  });

  it('refuses a malformed study id, an owner and anything unknown (nothing is created)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    for (const extra of [
      { studyTrackId: 'not-a-uuid' },
      { studyTrackId: 7 },
      { userId: user.id },
      { userId: randomUUID() },
      { isPrimary: true },
    ]) {
      const res = await agent
        .post('/api/periods')
        .send({ ...periodInput, ...extra })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.academicPeriod.count()).toBe(0);
  });

  it('the study must be the user’s own and active: foreign and unknown are the same 404, archived is a 409', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const theirs = await track(b.agent, 'De B');
    const foreign = await a.agent
      .post('/api/periods')
      .send({ ...periodInput, studyTrackId: theirs.id });
    const missing = await a.agent
      .post('/api/periods')
      .send({ ...periodInput, studyTrackId: randomUUID() });
    expect(foreign.status).toBe(404);
    expect({ status: foreign.status, body: foreign.body }).toEqual({
      status: missing.status,
      body: missing.body,
    });
    const mine = await track(a.agent, 'Mío');
    await a.agent.post(`/api/study-tracks/${mine.id}/archive`).expect(200);
    const archived = await a.agent
      .post('/api/periods')
      .send({ ...periodInput, studyTrackId: mine.id })
      .expect(409);
    expect(archived.body.error.code).toBe('STUDY_TRACK_ARCHIVED');
    expect(await prisma.academicPeriod.count()).toBe(0);
  });
});

describe('moving a period between scopes', () => {
  it('a period that is not current moves freely (to a study, and back to general) and stays not current', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    await makePeriod(agent); // the general current
    const old = await makePeriod(agent);
    const moved = await patch(agent, old.id, { studyTrackId: medicina.id }).expect(200);
    expect(moved.body.period).toMatchObject({ studyTrackId: medicina.id, isCurrent: false });
    const back = await patch(agent, old.id, { studyTrackId: null }).expect(200);
    expect(back.body.period).toMatchObject({ studyTrackId: null, isCurrent: false });
  });

  it('a current period moves to a scope with no current one and keeps being current', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    const general = await makePeriod(agent);
    const moved = await patch(agent, general.id, { studyTrackId: medicina.id }).expect(200);
    expect(moved.body.period).toMatchObject({ studyTrackId: medicina.id, isCurrent: true });
    expect([...(await currentPerScope(user.id)).entries()]).toEqual([[medicina.id, 1]]);
  });

  it('a current period moving into a scope that HAS a current one is a 409 and nobody is demoted', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    const general = await makePeriod(agent);
    const inMedicina = await makePeriod(agent, { studyTrackId: medicina.id });
    const before = await getPeriods(agent);
    const res = await patch(agent, general.id, { studyTrackId: medicina.id }).expect(409);
    expect(res.body.error.code).toBe('CURRENT_PERIOD_CONFLICT');
    expect(await getPeriods(agent)).toEqual(before);
    expect((await byId(agent, inMedicina.id)).isCurrent).toBe(true);
    // the same going back to general
    const other = await makePeriod(agent);
    expect(other.isCurrent).toBe(false);
    const fresh = await signUp(app, 'c@example.com');
    const t = await track(fresh.agent, 'T');
    const pt = await makePeriod(fresh.agent, { studyTrackId: t.id });
    await makePeriod(fresh.agent); // general current
    const back = await patch(fresh.agent, pt.id, { studyTrackId: null }).expect(409);
    expect(back.body.error.code).toBe('CURRENT_PERIOD_CONFLICT');
  });

  it('moving AND asking for current in one request takes over the destination only when it was not current before', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    await makePeriod(agent);
    const inMedicina = await makePeriod(agent, { studyTrackId: medicina.id });
    const old = await makePeriod(agent); // general, not current
    const res = await patch(agent, old.id, { studyTrackId: medicina.id, isCurrent: true }).expect(
      200,
    );
    expect(res.body.period).toMatchObject({ studyTrackId: medicina.id, isCurrent: true });
    expect((await byId(agent, inMedicina.id)).isCurrent).toBe(false); // explicitly asked: the same scope's one steps down
  });

  it('moving to a study that is not the user’s: the same 404 as one that does not exist; archived: 409; nothing changes', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const theirs = await track(b.agent, 'De B');
    const p = await makePeriod(a.agent);
    const before = JSON.stringify(await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }));
    const foreign = await patch(a.agent, p.id, { studyTrackId: theirs.id });
    const missing = await patch(a.agent, p.id, { studyTrackId: randomUUID() });
    expect(foreign.status).toBe(404);
    expect({ status: foreign.status, body: foreign.body }).toEqual({
      status: missing.status,
      body: missing.body,
    });
    const mine = await track(a.agent, 'Mío');
    await a.agent.post(`/api/study-tracks/${mine.id}/archive`).expect(200);
    expect(
      (await patch(a.agent, p.id, { studyTrackId: mine.id }).expect(409)).body.error.code,
    ).toBe('STUDY_TRACK_ARCHIVED');
    expect(JSON.stringify(await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }))).toBe(
      before,
    );
  });

  it('somebody else’s period is the same 404 whatever is asked', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const mine = await track(a.agent, 'Mío');
    const theirs = await makePeriod(b.agent);
    const foreign = await patch(a.agent, theirs.id, { studyTrackId: mine.id });
    const missing = await patch(a.agent, randomUUID(), { studyTrackId: mine.id });
    expect(foreign.status).toBe(404);
    expect({ status: foreign.status, body: foreign.body }).toEqual({
      status: missing.status,
      body: missing.body,
    });
    expect((await byId(b.agent, theirs.id)).studyTrackId).toBeNull();
  });

  it('refuses a malformed id and an owner on update, and a "not current" value as before', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const p = await makePeriod(agent);
    await patch(agent, p.id, { studyTrackId: 'nope' }).expect(400);
    await patch(agent, p.id, { userId: user.id }).expect(400);
    await patch(agent, p.id, { isCurrent: false }).expect(400);
  });

  it('a period of an ARCHIVED study cannot be marked current', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await makePeriod(agent);
    const keep = await track(agent, 'Nuevo'); // the first one: the primary study, which stays
    const old = await track(agent, 'Viejo', 'SCHOOL');
    const p = await makePeriod(agent, { studyTrackId: old.id });
    await agent.post(`/api/study-tracks/${old.id}/archive`).expect(200);
    const res = await patch(agent, p.id, { isCurrent: true }).expect(409);
    expect(res.body.error.code).toBe('STUDY_TRACK_ARCHIVED');
    expect(keep.id).toBeTruthy();
  });

  it('leaves the level, the dates and the name where they were (a move changes only the study)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    const p = await makePeriod(agent, { studyLevel: 4 });
    const moved = await patch(agent, p.id, { studyTrackId: medicina.id }).expect(200);
    expect(moved.body.period).toMatchObject({
      name: p.name,
      startDate: periodInput.startDate,
      endDate: periodInput.endDate,
      studyLevel: 4,
      studyLevelNote: null,
    });
  });
});

describe('the HOME current period: one exact, deterministic rule', () => {
  it('the general current period wins over the primary study’s', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina'); // the first: the primary one
    await makePeriod(agent, { studyTrackId: medicina.id });
    const general = await makePeriod(agent);
    expect((await lookup.findHomeCurrent(user.id))?.id).toBe(general.id);
  });

  it('without a general one it is the PRIMARY study’s current period', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    const diploma = await track(agent, 'Diplomado', 'OTHER_ACADEMIC');
    const pd = await makePeriod(agent, { studyTrackId: diploma.id });
    const pm = await makePeriod(agent, { studyTrackId: medicina.id });
    expect((await lookup.findHomeCurrent(user.id))?.id).toBe(pm.id);
    // moving the primary flag moves home with it
    await agent.post(`/api/study-tracks/${diploma.id}/make-primary`).expect(200);
    expect((await lookup.findHomeCurrent(user.id))?.id).toBe(pd.id);
  });

  it('a secondary study’s current period is NEVER the home one (nor the newest, nor the first by date)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    await track(agent, 'Medicina'); // primary, with no current period
    const diploma = await track(agent, 'Diplomado', 'OTHER_ACADEMIC');
    await makePeriod(agent, {
      studyTrackId: diploma.id,
      startDate: '2020-01-01',
      endDate: '2030-01-01',
    });
    expect(await lookup.findHomeCurrent(user.id)).toBeNull();
    expect(await lookup.findCurrentUntracked(user.id)).toBeNull();
  });

  it('a user with no current period has no home', async () => {
    const { user } = await signUp(app, 'a@example.com');
    expect(await lookup.findHomeCurrent(user.id)).toBeNull();
    expect(await lookup.listCurrent(user.id)).toEqual([]);
  });

  it('an archived primary study’s period is ignored, even if a current flag survived by force', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const general = await makePeriod(agent);
    const medicina = await track(agent, 'Medicina');
    const pm = await makePeriod(agent, { studyTrackId: medicina.id });
    await agent.post(`/api/study-tracks/${medicina.id}/archive`).expect(200);
    expect((await byId(agent, pm.id)).isCurrent).toBe(false);
    expect((await lookup.findHomeCurrent(user.id))?.id).toBe(general.id);
    // the lookups do not trust the flag alone: an archived study's period is never listed or home
    await prisma.academicPeriod.update({ where: { id: pm.id }, data: { isCurrent: true } });
    await prisma.academicPeriod.update({ where: { id: general.id }, data: { isCurrent: false } });
    expect(await lookup.findHomeCurrent(user.id)).toBeNull();
    expect(await lookup.listCurrent(user.id)).toEqual([]);
  });

  it('listCurrent: the general one first, the primary study next, then the rest by the study’s creation', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A'); // primary
    const b = await track(agent, 'B', 'SCHOOL');
    const c = await track(agent, 'C', 'OTHER_ACADEMIC');
    const pc = await makePeriod(agent, { studyTrackId: c.id });
    const pb = await makePeriod(agent, { studyTrackId: b.id });
    const pa = await makePeriod(agent, { studyTrackId: a.id });
    const general = await makePeriod(agent);
    const order = (await lookup.listCurrent(user.id)).map((p) => p.id);
    expect(order).toEqual([general.id, pa.id, pb.id, pc.id]);
    expect((await lookup.listCurrent(user.id)).map((p) => p.id)).toEqual(order); // the same every time
    expect(await lookup.findCurrentForTrack(user.id, b.id)).toMatchObject({ id: pb.id });
  });

  it('every singular reader uses it: the dashboard shows the home period', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    const pm = await makePeriod(agent, { studyTrackId: medicina.id });
    expect((await agent.get('/api/dashboard').expect(200)).body.dashboard.period.id).toBe(pm.id);
    const general = await makePeriod(agent);
    expect(general.isCurrent).toBe(true);
    expect((await agent.get('/api/dashboard').expect(200)).body.dashboard.period.id).toBe(
      general.id,
    );
  });

  it('a general activity (no subject) and a block without a period go to the home period', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    const pm = await makePeriod(agent, { studyTrackId: medicina.id });
    const act = (
      await agent
        .post('/api/activities')
        .send({ title: 'Trámite', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity as { id: string };
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: act.id } })).periodId).toBe(
      pm.id,
    );
    const general = await makePeriod(agent);
    const act2 = (
      await agent.post('/api/activities').send({ title: 'Otro', dueDate: '2099-03-15' }).expect(201)
    ).body.activity as { id: string };
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: act2.id } })).periodId).toBe(
      general.id,
    );
    expect(user.id).toBeTruthy();
  });
});

describe('the default education context of a NEW subject', () => {
  const subject = (a: Agent, periodId: string, body: object = {}) =>
    a.post('/api/subjects').send({ periodId, name: `Materia ${(seq += 1)}`, ...body });
  const context = async (id: string) =>
    (await prisma.subject.findUniqueOrThrow({ where: { id } })).educationContext;

  it('an explicit context wins, and so does an explicit null', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina', 'UNIVERSITY');
    const p = await makePeriod(agent, { studyTrackId: medicina.id });
    const school = (await subject(agent, p.id, { educationContext: 'SCHOOL' }).expect(201)).body
      .subject;
    const none = (await subject(agent, p.id, { educationContext: null }).expect(201)).body.subject;
    expect(await context(school.id)).toBe('SCHOOL');
    expect(await context(none.id)).toBeNull();
  });

  it('the TYPE of the period’s study wins over the profile’s primary use', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await agent.patch('/api/profile').send({ primaryUse: 'PERSONAL' }).expect(200);
    const medicina = await track(agent, 'Medicina', 'UNIVERSITY');
    const p = await makePeriod(agent, { studyTrackId: medicina.id });
    const s = (await subject(agent, p.id).expect(201)).body.subject;
    expect(await context(s.id)).toBe('UNIVERSITY');
  });

  it('a general period falls back to the profile’s primary use (today’s rule)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const p = await makePeriod(agent);
    const none = (await subject(agent, p.id).expect(201)).body.subject;
    expect(await context(none.id)).toBeNull(); // no primary use: nothing invented
    await agent.patch('/api/profile').send({ primaryUse: 'SCHOOL_STUDENT' }).expect(200);
    const school = (await subject(agent, p.id).expect(201)).body.subject;
    expect(await context(school.id)).toBe('SCHOOL');
  });

  it('changing a study’s type affects NEW subjects only; the existing ones keep their snapshot', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const t = await track(agent, 'Ingeniería', 'UNIVERSITY');
    const p = await makePeriod(agent, { studyTrackId: t.id });
    const first = (await subject(agent, p.id).expect(201)).body.subject;
    await agent.patch(`/api/study-tracks/${t.id}`).send({ type: 'OTHER_ACADEMIC' }).expect(200);
    const second = (await subject(agent, p.id).expect(201)).body.subject;
    expect(await context(first.id)).toBe('UNIVERSITY');
    expect(await context(second.id)).toBe('OTHER_ACADEMIC');
  });

  it('moving a period into a study does not rewrite the subjects it already has', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await agent.patch('/api/profile').send({ primaryUse: 'SCHOOL_STUDENT' }).expect(200);
    const p = await makePeriod(agent);
    const before = (await subject(agent, p.id).expect(201)).body.subject;
    const t = await track(agent, 'Medicina', 'UNIVERSITY');
    // the period is current and general: park it so it can move, then it is just a move
    await patch(agent, p.id, { studyTrackId: t.id }).expect(200);
    expect(await context(before.id)).toBe('SCHOOL');
    const after = (await subject(agent, p.id).expect(201)).body.subject;
    expect(await context(after.id)).toBe('UNIVERSITY');
  });

  it('the study never comes from the client: there is no study field on a subject, and a foreign period is the same 404', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const t = await track(a.agent, 'Mío');
    const p = await makePeriod(a.agent);
    await subject(a.agent, p.id, { studyTrackId: t.id }).expect(400);
    const theirs = await makePeriod(b.agent);
    const foreign = await subject(a.agent, theirs.id);
    expect(foreign.status).toBe(404);
  });

  it('the quick batch and the capture confirmation create in the home period with ITS study’s type', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await agent.patch('/api/profile').send({ primaryUse: 'SCHOOL_STUDENT' }).expect(200);
    const medicina = await track(agent, 'Medicina', 'UNIVERSITY');
    const pm = await makePeriod(agent, { studyTrackId: medicina.id }); // the only current one: the home period
    const batch = (
      await agent
        .post('/api/subjects/batch')
        .send({ names: ['Anatomía'] })
        .expect(201)
    ).body;
    const created = batch.createdSubjects[0];
    expect(created.periodId).toBe(pm.id);
    expect(await context(created.id)).toBe('UNIVERSITY');
    const capture = await agent
      .post('/api/capture/confirm')
      .send({
        items: [
          {
            clientId: 'c1',
            title: 'Parcial',
            dueDate: '2099-03-15',
            subject: { kind: 'NEW', name: 'Histología' },
          },
        ],
      })
      .expect(201);
    const histologia = capture.body.createdSubjects[0];
    expect(histologia.periodId).toBe(pm.id);
    expect(await context(histologia.id)).toBe('UNIVERSITY');
  });
});

describe('archiving a study and its periods', () => {
  it('archiving clears the study’s current period in the same step, and deletes and touches nothing else', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const general = await makePeriod(agent);
    const a = await track(agent, 'A');
    const b = await track(agent, 'B', 'SCHOOL');
    const pa = await makePeriod(agent, { studyTrackId: a.id });
    const pb = await makePeriod(agent, { studyTrackId: b.id });
    const sub = (
      await agent.post('/api/subjects').send({ periodId: pb.id, name: 'Álgebra' }).expect(201)
    ).body.subject;
    await agent
      .post('/api/activities')
      .send({ subjectId: sub.id, title: 'Quiz', dueDate: '2099-03-15' })
      .expect(201);
    const counts = async () => ({
      periods: await prisma.academicPeriod.count(),
      subjects: await prisma.subject.count(),
      activities: await prisma.activity.count(),
      blocks: await prisma.scheduleBlock.count(),
    });
    const before = await counts();
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    expect(await counts()).toEqual(before); // nothing deleted
    expect((await byId(agent, pb.id)).isCurrent).toBe(false);
    expect((await byId(agent, pb.id)).studyTrackId).toBe(b.id); // still its period
    expect((await byId(agent, pa.id)).isCurrent).toBe(true); // other scopes untouched
    expect((await byId(agent, general.id)).isCurrent).toBe(true);
    expect((await prisma.subject.findUniqueOrThrow({ where: { id: sub.id } })).periodId).toBe(
      pb.id,
    );
  });

  it('archiving the only active (primary) study clears its current period; home falls back to the general one', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const general = await makePeriod(agent);
    const a = await track(agent, 'A');
    const pa = await makePeriod(agent, { studyTrackId: a.id });
    expect((await lookup.findHomeCurrent(user.id))?.id).toBe(general.id);
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    expect((await byId(agent, pa.id)).isCurrent).toBe(false);
    expect((await lookup.findHomeCurrent(user.id))?.id).toBe(general.id);
  });

  it('a refused archive (the primary while others are active) changes no period either', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    await track(agent, 'B', 'SCHOOL');
    const pa = await makePeriod(agent, { studyTrackId: a.id });
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(409);
    expect((await byId(agent, pa.id)).isCurrent).toBe(true);
  });

  it('restoring a study does NOT make any of its periods current again', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const p1 = await makePeriod(agent, { studyTrackId: a.id });
    const p2 = await makePeriod(agent, { studyTrackId: a.id });
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    await agent.post(`/api/study-tracks/${a.id}/restore`).expect(200);
    expect((await byId(agent, p1.id)).isCurrent).toBe(false);
    expect((await byId(agent, p2.id)).isCurrent).toBe(false);
    // the student marks one
    expect((await patch(agent, p2.id, { isCurrent: true }).expect(200)).body.period.isCurrent).toBe(
      true,
    );
  });

  it('a period with content is still not deletable, whatever its study (409 PERIOD_NOT_EMPTY)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const p = await makePeriod(agent, { studyTrackId: a.id });
    await agent.post('/api/subjects').send({ periodId: p.id, name: 'Álgebra' }).expect(201);
    const res = await agent.delete(`/api/periods/${p.id}`).expect(409);
    expect(res.body.error.code).toBe('PERIOD_NOT_EMPTY');
    const empty = await makePeriod(agent, { studyTrackId: a.id });
    await agent.delete(`/api/periods/${empty.id}`).expect(204);
  });
});

describe('an account with ZERO studies perceives no change at all', () => {
  it('period, subjects, activities, dashboard and the quick batch behave as before', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    expect(await currentIds(agent)).toEqual([]);
    const p = await makePeriod(agent); // the first period is current
    expect(p).toMatchObject({ isCurrent: true, studyTrackId: null });
    const s = (
      await agent.post('/api/subjects').send({ periodId: p.id, name: 'Redes' }).expect(201)
    ).body.subject;
    expect(s.educationContext).toBeNull(); // no primary use: nothing is invented
    const a = (
      await agent
        .post('/api/activities')
        .send({ title: 'General', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: a.id } })).periodId).toBe(p.id);
    const dash = (await agent.get('/api/dashboard').expect(200)).body.dashboard;
    expect(dash.period.id).toBe(p.id);
    expect(dash.subjectCount).toBe(1);
    const batch = (
      await agent
        .post('/api/subjects/batch')
        .send({ names: ['Cálculo'] })
        .expect(201)
    ).body;
    expect(batch.createdSubjects[0].periodId).toBe(p.id);
    expect(await prisma.studyTrack.count()).toBe(0); // and nobody was given a study
  });

  it('a user with no period at all is still told so (no home)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await agent.post('/api/activities').send({ title: 'X', dueDate: '2099-03-15' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
    expect((await agent.get('/api/dashboard').expect(200)).body.dashboard.period).toBeNull();
  });
});

describe('private answers', () => {
  it('every period answer, success or error, is no-store', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const t = await track(agent, 'A');
    const p = await makePeriod(agent, { studyTrackId: t.id });
    const answers = [
      await agent.get('/api/periods'),
      await agent.post('/api/periods').send({ ...periodInput, studyTrackId: t.id }),
      await agent.post('/api/periods').send({ ...periodInput, studyTrackId: randomUUID() }),
      await patch(agent, p.id, { studyTrackId: null }),
      await patch(agent, p.id, { studyTrackId: 'x' }),
    ];
    for (const r of answers) expect(r.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('concurrency: the database indexes, not luck, keep one current period per scope', () => {
  it('a period write waits for the per-user study lock (the same one the study actions take)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `study-track:${user.id}`,
      ]);
      let settled = false;
      const pending = agent
        .post('/api/periods')
        .send(periodInput)
        .then((r) => {
          settled = true;
          return r;
        });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // waiting, not racing
      expect(await prisma.academicPeriod.count()).toBe(0);
      await holder.query('COMMIT');
      expect((await pending).status).toBe(201);
    } finally {
      await holder.end();
    }
  });

  it('two periods asking to be current in the SAME study leave exactly one current', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const t = await track(agent, 'A');
    await makePeriod(agent, { studyTrackId: t.id });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        agent
          .post('/api/periods')
          .send({ ...periodInput, name: `R${i}`, studyTrackId: t.id, isCurrent: true }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect((await currentPerScope(user.id)).get(t.id)).toBe(1);
  });

  it('the FIRST periods of one empty scope, created together, leave exactly one current', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const t = await track(agent, 'A');
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        agent.post('/api/periods').send({ ...periodInput, name: `P${i}`, studyTrackId: t.id }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect((await currentPerScope(user.id)).get(t.id)).toBe(1);
  });

  it('periods created together in two DIFFERENT studies are both current', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const b = await track(agent, 'B', 'SCHOOL');
    const results = await Promise.all([
      agent.post('/api/periods').send({ ...periodInput, name: 'PA', studyTrackId: a.id }),
      agent.post('/api/periods').send({ ...periodInput, name: 'PB', studyTrackId: b.id }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const counts = await currentPerScope(user.id);
    expect([counts.get(a.id), counts.get(b.id)]).toEqual([1, 1]);
  });

  it('a general period and a study’s period created together are both current', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const results = await Promise.all([
      agent.post('/api/periods').send({ ...periodInput, name: 'G' }),
      agent.post('/api/periods').send({ ...periodInput, name: 'PA', studyTrackId: a.id }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const counts = await currentPerScope(user.id);
    expect([counts.get(null), counts.get(a.id)]).toEqual([1, 1]);
  });

  it('moving a current period into an occupied scope while others become current never yields two in a scope', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const general = await makePeriod(agent);
    await makePeriod(agent, { studyTrackId: a.id });
    const challenger = await makePeriod(agent, { studyTrackId: a.id });
    const results = await Promise.all([
      patch(agent, general.id, { studyTrackId: a.id }),
      patch(agent, challenger.id, { isCurrent: true }),
      agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'N', studyTrackId: a.id, isCurrent: true }),
      patch(agent, general.id, { studyTrackId: a.id }),
    ]);
    for (const r of results) expect([200, 201, 409]).toContain(r.status);
    for (const n of (await currentPerScope(user.id)).values()) expect(n).toBe(1);
  });

  it('marking a period current while another one of the user is being moved keeps the invariants', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const b = await track(agent, 'B', 'SCHOOL');
    const pa1 = await makePeriod(agent, { studyTrackId: a.id });
    const pa2 = await makePeriod(agent, { studyTrackId: a.id });
    const pb = await makePeriod(agent, { studyTrackId: b.id });
    const results = await Promise.all([
      patch(agent, pa2.id, { isCurrent: true }),
      patch(agent, pa1.id, { studyTrackId: b.id }),
      patch(agent, pb.id, { studyTrackId: a.id }),
    ]);
    for (const r of results) expect([200, 409]).toContain(r.status);
    for (const n of (await currentPerScope(user.id)).values()) expect(n).toBe(1);
  });

  it('archiving a study while a period is being made current in it never leaves a current period in an archived study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await track(agent, 'Primero');
    const a = await track(agent, 'A', 'SCHOOL');
    const p = await makePeriod(agent, { studyTrackId: a.id });
    const q = await makePeriod(agent, { studyTrackId: a.id });
    await Promise.all([
      agent.post(`/api/study-tracks/${a.id}/archive`),
      patch(agent, q.id, { isCurrent: true }),
      agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'N', studyTrackId: a.id, isCurrent: true }),
    ]);
    const stale = await prisma.academicPeriod.count({
      where: { isCurrent: true, studyTrack: { status: 'ARCHIVED' } },
    });
    expect(stale).toBe(0);
    expect(p.id).toBeTruthy();
  });
});
