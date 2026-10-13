import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
interface Track {
  id: string;
  name: string;
  type: string;
  programKey: string | null;
  isPrimary: boolean;
  status: string;
}

const list = async (a: Agent) =>
  (await a.get('/api/study-tracks').expect(200)).body.studyTracks as Track[];
const create = (a: Agent, body: object) => a.post('/api/study-tracks').send(body);
const make = async (a: Agent, body: object) =>
  (await create(a, body).expect(201)).body.studyTrack as Track;
const primaries = (tracks: Track[]) => tracks.filter((t) => t.isPrimary);
const dbPrimaries = (userId: string) =>
  prisma.studyTrack.count({ where: { userId, isPrimary: true } });

describe('listing the studies', () => {
  it('a new account has none (the model exists, nobody is given one)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    expect(await list(agent)).toEqual([]);
  });

  it('is private: it needs a session', async () => {
    await request(app).get('/api/study-tracks').expect(401);
    await request(app).post('/api/study-tracks').send({ name: 'X', type: 'SCHOOL' }).expect(401);
  });
});

describe('creating a study', () => {
  it('the FIRST one is the primary one (the server decides), the second is not', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const first = await make(agent, { name: 'Medicina', type: 'UNIVERSITY' });
    const second = await make(agent, {
      name: 'Diplomado en Ciberseguridad',
      type: 'OTHER_ACADEMIC',
    });
    expect(first).toMatchObject({ isPrimary: true, status: 'ACTIVE' });
    expect(second).toMatchObject({ isPrimary: false, status: 'ACTIVE' });
    expect(await dbPrimaries(user.id)).toBe(1);
  });

  it('answers 201 with the study and no owner', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const res = await create(agent, { name: 'Colegio', type: 'SCHOOL' }).expect(201);
    expect(Object.keys(res.body)).toEqual(['studyTrack']);
    expect(Object.keys(res.body.studyTrack).sort()).toEqual(
      ['createdAt', 'id', 'isPrimary', 'name', 'programKey', 'status', 'type', 'updatedAt'].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain(user.id);
  });

  it('takes any of the three types, and nothing else (never PERSONAL)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    for (const type of ['UNIVERSITY', 'SCHOOL', 'OTHER_ACADEMIC']) {
      expect((await make(agent, { name: `E ${type}`, type })).type).toBe(type);
    }
    await create(agent, { name: 'Mi vida', type: 'PERSONAL' }).expect(400);
    await create(agent, { name: 'X' }).expect(400);
  });

  it('a name of their own is kept as written (trimmed), with no catalog key', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const t = await make(agent, { name: '  Técnico en Sistemas ', type: 'OTHER_ACADEMIC' });
    expect(t).toMatchObject({ name: 'Técnico en Sistemas', programKey: null });
  });

  it('a catalog key brings the canonical name (the name may be left out, or be exactly that one)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    expect(await make(agent, { type: 'UNIVERSITY', programKey: 'medicina' })).toMatchObject({
      name: 'Medicina',
      programKey: 'medicina',
    });
    expect(
      await make(agent, { type: 'UNIVERSITY', programKey: 'derecho', name: 'Derecho' }),
    ).toMatchObject({ name: 'Derecho', programKey: 'derecho' });
  });

  it('never "medicina" with the name "Derecho", an unknown key, or no name at all', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await create(agent, { type: 'UNIVERSITY', programKey: 'medicina', name: 'Derecho' }).expect(
      400,
    );
    await create(agent, { type: 'UNIVERSITY', programKey: 'astrologia' }).expect(400);
    await create(agent, { type: 'UNIVERSITY' }).expect(400);
    expect(await list(agent)).toEqual([]);
  });

  it('refuses an empty, blank, long or NUL name with a validation error, not a 500', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    for (const name of ['', '   ', 'x'.repeat(81), 'Med\u0000icina']) {
      const res = await create(agent, { name, type: 'SCHOOL' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await list(agent)).toEqual([]);
  });

  it('the same name twice is allowed (a study is not identified by its name)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await make(agent, { name: 'Inglés', type: 'OTHER_ACADEMIC' });
    await make(agent, { name: 'Inglés', type: 'OTHER_ACADEMIC' });
    expect(await list(agent)).toHaveLength(2);
  });
});

describe('the list order: the primary first, the active ones, the archived at the end', () => {
  it('is stable and follows creation within each group', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const b = await make(agent, { name: 'B', type: 'SCHOOL' });
    const c = await make(agent, { name: 'C', type: 'OTHER_ACADEMIC' });
    const d = await make(agent, { name: 'D', type: 'OTHER_ACADEMIC' });
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    expect((await list(agent)).map((t) => t.name)).toEqual(['A', 'C', 'D', 'B']);
    await agent.post(`/api/study-tracks/${d.id}/make-primary`).expect(200);
    expect((await list(agent)).map((t) => t.name)).toEqual(['D', 'A', 'C', 'B']);
    expect(c.isPrimary).toBe(false);
    expect(a.isPrimary).toBe(true);
  });
});

describe('editing a study', () => {
  it('renames it (a name of their own drops a catalog key) and trims', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const t = await make(agent, { type: 'UNIVERSITY', programKey: 'medicina' });
    const res = await agent
      .patch(`/api/study-tracks/${t.id}`)
      .send({ name: ' Medicina del Deporte ' })
      .expect(200);
    expect(res.body.studyTrack).toMatchObject({ name: 'Medicina del Deporte', programKey: null });
  });

  it('the very same name keeps the key; a key brings the canonical name; programKey null keeps the name', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const t = await make(agent, { type: 'UNIVERSITY', programKey: 'medicina' });
    const same = await agent
      .patch(`/api/study-tracks/${t.id}`)
      .send({ name: 'Medicina' })
      .expect(200);
    expect(same.body.studyTrack).toMatchObject({ name: 'Medicina', programKey: 'medicina' });
    const other = await agent
      .patch(`/api/study-tracks/${t.id}`)
      .send({ programKey: 'derecho' })
      .expect(200);
    expect(other.body.studyTrack).toMatchObject({ name: 'Derecho', programKey: 'derecho' });
    const detached = await agent
      .patch(`/api/study-tracks/${t.id}`)
      .send({ programKey: null })
      .expect(200);
    expect(detached.body.studyTrack).toMatchObject({ name: 'Derecho', programKey: null });
  });

  it('refuses a key with another name, an unknown key, and a bad name', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const t = await make(agent, { name: 'Colegio', type: 'SCHOOL' });
    const patch = (b: object) => agent.patch(`/api/study-tracks/${t.id}`).send(b);
    await patch({ programKey: 'medicina', name: 'Derecho' }).expect(400);
    await patch({ programKey: 'astrologia' }).expect(400);
    await patch({ name: '' }).expect(400);
    await patch({ name: 'a\u0000b' }).expect(400);
    await patch({}).expect(400);
    expect((await list(agent))[0]).toMatchObject({ name: 'Colegio', programKey: null });
  });

  it('the TYPE is correctable: OTHER_ACADEMIC -> UNIVERSITY', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const t = await make(agent, { name: 'Ingeniería', type: 'OTHER_ACADEMIC' });
    const res = await agent
      .patch(`/api/study-tracks/${t.id}`)
      .send({ type: 'UNIVERSITY' })
      .expect(200);
    expect(res.body.studyTrack.type).toBe('UNIVERSITY');
    expect((await list(agent))[0]!.type).toBe('UNIVERSITY');
    await agent.patch(`/api/study-tracks/${t.id}`).send({ type: 'PERSONAL' }).expect(400);
  });

  it('changing the type touches NO other entity: subjects keep the snapshot they were created with', async () => {
    const { agent, user, period } = await setupUser(app, 'a@example.com');
    const subject = (
      await agent
        .post('/api/subjects')
        .send({ periodId: period.id, name: 'Anatomía', educationContext: 'OTHER_ACADEMIC' })
        .expect(201)
    ).body.subject as { id: string };
    await agent
      .post('/api/activities')
      .send({ subjectId: subject.id, title: 'Parcial', dueDate: '2099-03-15' })
      .expect(201);
    await agent
      .patch('/api/profile')
      .send({ primaryUse: 'UNIVERSITY_STUDENT', programKey: 'medicina' })
      .expect(200);
    const t = await make(agent, { name: 'Medicina', type: 'OTHER_ACADEMIC' });
    const everything = async () =>
      JSON.stringify([
        await prisma.user.findMany({ orderBy: { id: 'asc' } }),
        await prisma.userProfile.findMany(),
        await prisma.academicPeriod.findMany({ orderBy: { id: 'asc' } }),
        await prisma.subject.findMany({ orderBy: { id: 'asc' } }),
        await prisma.activity.findMany({ orderBy: { id: 'asc' } }),
        await prisma.reminder.findMany({ orderBy: { id: 'asc' } }),
        await prisma.scheduleBlock.findMany({ orderBy: { id: 'asc' } }),
      ]);
    const before = await everything();

    await agent.patch(`/api/study-tracks/${t.id}`).send({ type: 'UNIVERSITY' }).expect(200);

    expect(await everything()).toBe(before); // byte for byte, timestamps included
    expect(
      (await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } })).educationContext,
    ).toBe('OTHER_ACADEMIC');
    expect(user.id).toBeTruthy();
  });
});

describe('the primary study', () => {
  const three = async (agent: Agent) => ({
    a: await make(agent, { name: 'A', type: 'UNIVERSITY' }),
    b: await make(agent, { name: 'B', type: 'SCHOOL' }),
    c: await make(agent, { name: 'C', type: 'OTHER_ACADEMIC' }),
  });

  it('make-primary moves the flag in one step and answers the whole list', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const { b } = await three(agent);
    const res = await agent.post(`/api/study-tracks/${b.id}/make-primary`).expect(200);
    const tracks = res.body.studyTracks as Track[];
    expect(primaries(tracks).map((t) => t.name)).toEqual(['B']);
    expect(tracks[0]!.name).toBe('B'); // the primary comes first
    expect(await dbPrimaries(user.id)).toBe(1);
  });

  it('choosing the one that already is the primary changes nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { a } = await three(agent);
    const before = await list(agent);
    await agent.post(`/api/study-tracks/${a.id}/make-primary`).expect(200);
    expect(await list(agent)).toEqual(before);
  });

  it('an archived study cannot be the primary one', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { b } = await three(agent);
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    const res = await agent.post(`/api/study-tracks/${b.id}/make-primary`).expect(409);
    expect(res.body.error.code).toBe('STUDY_TRACK_ARCHIVED');
    expect(primaries(await list(agent)).map((t) => t.name)).toEqual(['A']);
  });

  it('there is no way to set the flag directly, nor a status, on create or edit', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { a, b } = await three(agent);
    await agent.patch(`/api/study-tracks/${b.id}`).send({ isPrimary: true }).expect(400);
    await agent.patch(`/api/study-tracks/${a.id}`).send({ isPrimary: false }).expect(400);
    await agent.patch(`/api/study-tracks/${a.id}`).send({ status: 'ARCHIVED' }).expect(400);
    await create(agent, { name: 'D', type: 'SCHOOL', isPrimary: true }).expect(400);
    await create(agent, { name: 'D', type: 'SCHOOL', status: 'ARCHIVED' }).expect(400);
    expect(primaries(await list(agent)).map((t) => t.name)).toEqual(['A']);
  });
});

describe('archiving and restoring (nothing is ever deleted)', () => {
  it('a secondary study can be archived; it keeps existing and the primary does not move', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const b = await make(agent, { name: 'B', type: 'SCHOOL' });
    const res = await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    const tracks = res.body.studyTracks as Track[];
    expect(tracks.map((t) => [t.name, t.status, t.isPrimary])).toEqual([
      ['A', 'ACTIVE', true],
      ['B', 'ARCHIVED', false],
    ]);
  });

  it('the primary cannot be archived while other active ones exist: the student chooses the replacement', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const b = await make(agent, { name: 'B', type: 'SCHOOL' });
    const res = await agent.post(`/api/study-tracks/${a.id}/archive`).expect(409);
    expect(res.body.error.code).toBe('PRIMARY_TRACK_REQUIRES_REPLACEMENT');
    expect(primaries(await list(agent)).map((t) => t.name)).toEqual(['A']); // nothing was picked silently
    await agent.post(`/api/study-tracks/${b.id}/make-primary`).expect(200);
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    expect((await list(agent)).map((t) => [t.name, t.status, t.isPrimary])).toEqual([
      ['B', 'ACTIVE', true],
      ['A', 'ARCHIVED', false],
    ]);
  });

  it('the only active study can be archived: the user is left with NO primary (zero is valid)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const res = await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    expect(res.body.studyTracks).toHaveLength(1);
    expect(res.body.studyTracks[0]).toMatchObject({ status: 'ARCHIVED', isPrimary: false });
    expect(await dbPrimaries(user.id)).toBe(0);
  });

  it('archiving twice, restoring an active one: nothing changes', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const b = await make(agent, { name: 'B', type: 'SCHOOL' });
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    const once = await list(agent);
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    expect(await list(agent)).toEqual(once);
    await agent.post(`/api/study-tracks/${b.id}/restore`).expect(200);
    const restored = await list(agent);
    await agent.post(`/api/study-tracks/${b.id}/restore`).expect(200);
    expect(await list(agent)).toEqual(restored);
  });

  it('restoring keeps the existing primary where it is', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const b = await make(agent, { name: 'B', type: 'SCHOOL' });
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);
    const res = await agent.post(`/api/study-tracks/${b.id}/restore`).expect(200);
    expect((res.body.studyTracks as Track[]).map((t) => [t.name, t.status, t.isPrimary])).toEqual([
      ['A', 'ACTIVE', true],
      ['B', 'ACTIVE', false],
    ]);
  });

  it('restoring when there is no active study makes it the primary one (the same rule as the first)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    expect(await dbPrimaries(user.id)).toBe(0);
    const res = await agent.post(`/api/study-tracks/${a.id}/restore`).expect(200);
    expect(res.body.studyTracks[0]).toMatchObject({ status: 'ACTIVE', isPrimary: true });
    expect(await dbPrimaries(user.id)).toBe(1);
  });

  it('a new study after archiving everything is the primary one (there is no active one)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    await agent.post(`/api/study-tracks/${a.id}/archive`).expect(200);
    expect(await make(agent, { name: 'B', type: 'SCHOOL' })).toMatchObject({ isPrimary: true });
  });

  it('there is no DELETE: a study is never deleted to "finish" it', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    await agent.delete(`/api/study-tracks/${a.id}`).expect(404);
    expect(await list(agent)).toHaveLength(1);
  });
});

describe('ownership: a foreign study is indistinguishable from one that does not exist', () => {
  it('every route that takes an id answers the same 404, and changes nothing', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const mine = await make(a.agent, { name: 'De A', type: 'UNIVERSITY' });
    await make(b.agent, { name: 'De B', type: 'SCHOOL' });
    const before = JSON.stringify(await prisma.studyTrack.findMany({ orderBy: { id: 'asc' } }));
    const calls: ((id: string) => request.Test)[] = [
      (id) => b.agent.patch(`/api/study-tracks/${id}`).send({ name: 'Hackeado' }),
      (id) => b.agent.post(`/api/study-tracks/${id}/make-primary`),
      (id) => b.agent.post(`/api/study-tracks/${id}/archive`),
      (id) => b.agent.post(`/api/study-tracks/${id}/restore`),
    ];
    for (const call of calls) {
      const foreign = await call(mine.id);
      const missing = await call(randomUUID());
      const malformed = await call('not-a-uuid');
      expect(foreign.status).toBe(404);
      expect({ status: foreign.status, body: foreign.body }).toEqual({
        status: missing.status,
        body: missing.body,
      });
      expect(malformed.status).toBe(404);
      expect(malformed.body).toEqual(missing.body);
    }
    expect(JSON.stringify(await prisma.studyTrack.findMany({ orderBy: { id: 'asc' } }))).toBe(
      before,
    );
  });

  it('each user lists only their own studies and has their own primary', async () => {
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await make(a.agent, { name: 'De A', type: 'UNIVERSITY' });
    const mineB = await make(b.agent, { name: 'De B', type: 'SCHOOL' });
    expect((await list(a.agent)).map((t) => t.name)).toEqual(['De A']);
    expect(await list(b.agent)).toEqual([mineB]);
    expect(mineB.isPrimary).toBe(true); // B's first, even though A already has a primary
  });
});

describe('strict bodies and private answers', () => {
  it('create refuses an owner, an id, a period, a primary use and anything unknown; nothing is created', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    for (const extra of [
      { userId: randomUUID() },
      { userId: user.id },
      { id: randomUUID() },
      { periodId: randomUUID() },
      { primaryUse: 'SCHOOL_STUDENT' },
      { isPrimary: true },
      { status: 'ARCHIVED' },
      { color: 'red' },
    ]) {
      const res = await create(agent, { name: 'X', type: 'SCHOOL', ...extra }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.studyTrack.count()).toBe(0);
  });

  it('the actions refuse a body (it is never silently ignored)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    for (const action of ['make-primary', 'archive', 'restore']) {
      await agent
        .post(`/api/study-tracks/${a.id}/${action}`)
        .send({ isPrimary: false })
        .expect(400);
    }
  });

  it('every answer, success or error, is no-store', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const answers = [
      await agent.get('/api/study-tracks'),
      await create(agent, { name: 'B', type: 'SCHOOL' }),
      await create(agent, { name: '', type: 'SCHOOL' }),
      await agent.patch(`/api/study-tracks/${a.id}`).send({ name: 'Z' }),
      await agent.post(`/api/study-tracks/${a.id}/make-primary`),
      await agent.post(`/api/study-tracks/${randomUUID()}/archive`),
      await request(app).get('/api/study-tracks'),
    ];
    for (const r of answers) expect(r.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('concurrency: the database, not luck, keeps at most one primary', () => {
  it('every write waits for the per-user lock (a request cannot interleave with another one of the same user)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `study-track:${user.id}`,
      ]);
      let settled = false;
      const pending = create(agent, { name: 'E', type: 'SCHOOL' }).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // it is waiting, not racing
      expect(await prisma.studyTrack.count()).toBe(0);
      await holder.query('COMMIT');
      expect((await pending).status).toBe(201);
    } finally {
      await holder.end();
    }
  });

  it('several simultaneous FIRST creates leave exactly one primary', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => create(agent, { name: `E${i}`, type: 'OTHER_ACADEMIC' })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201)); // none is lost, none needs a retry
    expect(await dbPrimaries(user.id)).toBe(1);
    expect(await prisma.studyTrack.count({ where: { userId: user.id } })).toBe(8);
    expect(primaries(await list(agent))).toHaveLength(1);
  });

  it('simultaneous make-primary requests end with exactly one primary', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C', 'D'])
      ids.push((await make(agent, { name: n, type: 'SCHOOL' })).id);
    const results = await Promise.all(
      ids.concat(ids).map((id) => agent.post(`/api/study-tracks/${id}/make-primary`)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(await dbPrimaries(user.id)).toBe(1);
  });

  it('a make-primary racing an archive of the same study never leaves an archived primary or two primaries', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    await make(agent, { name: 'A', type: 'UNIVERSITY' });
    const b = await make(agent, { name: 'B', type: 'SCHOOL' });
    const results = await Promise.all([
      agent.post(`/api/study-tracks/${b.id}/make-primary`),
      agent.post(`/api/study-tracks/${b.id}/archive`),
    ]);
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(await dbPrimaries(user.id)).toBeLessThanOrEqual(1);
    expect(await prisma.studyTrack.count({ where: { isPrimary: true, status: 'ARCHIVED' } })).toBe(
      0,
    );
  });
});

describe('everything else stays exactly as it was (the study is linked to nothing)', () => {
  it('creating, editing, archiving studies leaves the profile, periods, subjects and /me untouched', async () => {
    const { agent, period } = await setupUser(app, 'a@example.com');
    await agent
      .patch('/api/profile')
      .send({ primaryUse: 'UNIVERSITY_STUDENT', programKey: 'medicina' })
      .expect(200);
    const snapshot = async () => ({
      profile: (await agent.get('/api/profile')).body,
      periods: (await agent.get('/api/periods')).body,
      subjects: (await agent.get('/api/subjects')).body,
      me: (await agent.get('/api/auth/me')).body,
    });
    const before = await snapshot();

    const a = await make(agent, { type: 'UNIVERSITY', programKey: 'medicina' });
    const b = await make(agent, { name: 'Diplomado', type: 'OTHER_ACADEMIC' });
    await agent
      .patch(`/api/study-tracks/${a.id}`)
      .send({ name: 'Otra cosa', type: 'SCHOOL' })
      .expect(200);
    await agent.post(`/api/study-tracks/${b.id}/archive`).expect(200);

    expect(await snapshot()).toEqual(before);
    expect(before.me.user).not.toHaveProperty('studyTracks');
    expect(before.periods.periods[0]).not.toHaveProperty('studyTrackId');
    expect(period.id).toBeTruthy();
  });

  it('a user that exists without any study keeps working exactly as before (the period guard, the dashboard)', async () => {
    const { agent } = await setupUser(app, 'a@example.com');
    expect(await list(agent)).toEqual([]);
    await agent.get('/api/dashboard').expect(200);
    await agent
      .post('/api/periods')
      .send({ ...periodInput, name: 'Otro' })
      .expect(201);
  });
});
