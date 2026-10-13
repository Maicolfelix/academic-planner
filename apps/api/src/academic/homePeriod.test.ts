import { randomUUID } from 'node:crypto';
import { homePeriodResponseSchema } from '@planner/core';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
interface Period {
  id: string;
  isCurrent: boolean;
  studyTrackId: string | null;
}
interface Track {
  id: string;
}

let seq = 0;
const track = async (a: Agent, name: string, type = 'UNIVERSITY') =>
  (await a.post('/api/study-tracks').send({ name, type }).expect(201)).body.studyTrack as Track;
const makePeriod = async (a: Agent, body: object = {}) => {
  seq += 1;
  return (
    await a
      .post('/api/periods')
      .send({ ...periodInput, name: `Periodo ${seq}`, ...body })
      .expect(201)
  ).body.period as Period;
};
const home = async (a: Agent) =>
  (await a.get('/api/periods/home').expect(200)).body.period as Period | null;
const listed = async (a: Agent) =>
  (await a.get('/api/periods').expect(200)).body.periods as Period[];

describe('GET /api/periods/home: the server says which period is the home one', () => {
  it('a general current period and a tracked current period: HOME is the general one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina');
    await makePeriod(agent, { studyTrackId: medicina.id });
    const general = await makePeriod(agent);
    expect((await home(agent))?.id).toBe(general.id);
  });

  it('no general period, and the PRIMARY study has a current one: HOME is that one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const medicina = await track(agent, 'Medicina'); // the first: the primary one
    const diploma = await track(agent, 'Diplomado', 'OTHER_ACADEMIC');
    await makePeriod(agent, { studyTrackId: diploma.id });
    const pm = await makePeriod(agent, { studyTrackId: medicina.id });
    expect((await home(agent))?.id).toBe(pm.id);
  });

  it('no general period, the primary study WITHOUT a current one and a secondary WITH one: HOME is null', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await track(agent, 'Medicina'); // primary, no current period
    const diploma = await track(agent, 'Diplomado', 'OTHER_ACADEMIC');
    const secondary = await makePeriod(agent, { studyTrackId: diploma.id });
    expect(secondary.isCurrent).toBe(true);
    // the list still shows a current period: that is exactly why a client must not decide "home" from it
    expect((await listed(agent)).some((p) => p.isCurrent)).toBe(true);
    expect(await home(agent)).toBeNull();
    // and everything that works with one period agrees with it
    expect((await agent.get('/api/dashboard').expect(200)).body.dashboard.period).toBeNull();
  });

  it('a legacy account with one general current period: exactly the period it always had', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const only = await makePeriod(agent);
    const answer = await home(agent);
    expect(answer).toEqual((await listed(agent)).find((p) => p.isCurrent));
    expect(answer?.id).toBe(only.id);
  });

  it('an account with no period at all: null, 200 (not an error)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await agent.get('/api/periods/home').expect(200);
    expect(res.body).toEqual({ period: null });
  });

  it('the answer has the declared shape (a full period, or null)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    expect(
      homePeriodResponseSchema.safeParse((await agent.get('/api/periods/home')).body).success,
    ).toBe(true);
    await makePeriod(agent);
    const body = (await agent.get('/api/periods/home')).body;
    expect(homePeriodResponseSchema.safeParse(body).success).toBe(true);
    expect(body.period).toHaveProperty('studyTrackId', null);
  });
});

describe('the home period follows the primary study without any period being touched', () => {
  it('make-primary changes HOME', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const b = await track(agent, 'B', 'SCHOOL');
    const pa = await makePeriod(agent, { studyTrackId: a.id });
    const pb = await makePeriod(agent, { studyTrackId: b.id });
    expect((await home(agent))?.id).toBe(pa.id);
    const before = JSON.stringify(await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }));
    await agent.post(`/api/study-tracks/${b.id}/make-primary`).expect(200);
    expect(JSON.stringify(await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }))).toBe(
      before,
    ); // no period touched
    expect((await home(agent))?.id).toBe(pb.id);
  });

  it('archiving the study that holds HOME changes it (to none here); archiving one that does not hold it changes nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A'); // primary
    const b = await track(agent, 'B', 'SCHOOL');
    const pa = await makePeriod(agent, { studyTrackId: a.id });
    await makePeriod(agent, { studyTrackId: b.id });
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    expect((await home(agent))?.id).toBe(pa.id); // B was not the home one
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200); // the only active one: its current period is turned off
    expect(await home(agent)).toBeNull();
  });

  it('with a general current period, archiving the primary study leaves HOME on the general one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const general = await makePeriod(agent);
    const a = await track(agent, 'A');
    await makePeriod(agent, { studyTrackId: a.id });
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    expect((await home(agent))?.id).toBe(general.id);
  });

  it('restoring a study does not bring a period back as HOME (no period is reactivated)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await track(agent, 'A');
    const pa = await makePeriod(agent, { studyTrackId: a.id });
    expect((await home(agent))?.id).toBe(pa.id);
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    await agent.post(`/api/study-tracks/${a.id}/restore`).expect(200);
    expect(await home(agent)).toBeNull(); // it is the primary again, but none of its periods is current
    await agent.patch(`/api/periods/${pa.id}`).send({ isCurrent: true }).expect(200);
    expect((await home(agent))?.id).toBe(pa.id);
  });
});

describe('the route, security and privacy of the home endpoint', () => {
  it('"home" is not read as a period id, and real ids keep working', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const p = await makePeriod(agent);
    expect((await agent.get('/api/periods/home')).status).toBe(200);
    expect((await agent.get(`/api/periods/${p.id}`)).status).toBe(200);
    expect((await agent.get('/api/periods/not-a-uuid')).status).toBe(404);
    expect((await agent.get(`/api/periods/${randomUUID()}`)).status).toBe(404);
  });

  it('needs a session, and is never stored', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const anonymous = await request(app).get('/api/periods/home');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    expect(anonymous.headers['cache-control']).toMatch(/no-store/);
    expect((await agent.get('/api/periods/home')).headers['cache-control']).toMatch(/no-store/);
  });

  it('it is a read: it writes nothing and creates no study', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await makePeriod(agent);
    const snapshot = async () =>
      JSON.stringify([
        await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }),
        await prisma.studyTrack.findMany({ orderBy: { id: 'asc' } }),
        await prisma.userProfile.findMany({ orderBy: { userId: 'asc' } }),
      ]);
    const before = await snapshot();
    for (let i = 0; i < 3; i++) await agent.get('/api/periods/home').expect(200);
    expect(await snapshot()).toBe(before);
  });

  it('the owner comes from the session only: nobody sees another user’s home period', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const mine = await makePeriod(a.agent);
    expect(await home(b.agent)).toBeNull();
    const theirs = await makePeriod(b.agent);
    expect((await home(a.agent))?.id).toBe(mine.id);
    expect((await home(b.agent))?.id).toBe(theirs.id);
    // a query string cannot name another user
    const res = await a.agent.get(`/api/periods/home?userId=${b.user.id}`).expect(200);
    expect(res.body.period.id).toBe(mine.id);
  });

  it('is a GET: no origin check is needed to read it, and no write method exists on it', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await agent.post('/api/periods/home').send({}).expect(404);
    await agent.patch('/api/periods/home').send({ name: 'x' }).expect(404);
    await agent.delete('/api/periods/home').expect(404);
  });
});
