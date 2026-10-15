import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;

const dates = { startDate: '2026-08-03', endDate: '2026-11-28' };
const setup = (a: Agent, body: object) => a.post('/api/study-tracks/setup').send(body);
const adopt = (a: Agent, body: object) => a.post('/api/study-tracks/adopt-period').send(body);
const tracks = async (a: Agent) =>
  (await a.get('/api/study-tracks').expect(200)).body.studyTracks as {
    id: string;
    name: string;
    type: string;
    isPrimary: boolean;
    status: string;
    programKey: string | null;
  }[];
const home = async (a: Agent) => (await a.get('/api/periods/home').expect(200)).body.period;
const current = async (a: Agent) =>
  (await a.get('/api/periods/current').expect(200)).body.periods as {
    period: { id: string };
    studyTrack: { id: string; name: string } | null;
  }[];
const body = (over: object = {}) => ({
  track: { name: 'Diplomado en Ciberseguridad', type: 'OTHER_ACADEMIC' },
  period: { name: 'Cohorte oct–dic', ...dates },
  ...over,
});

describe('POST /api/study-tracks/setup: a study, its first period and its subjects, all or nothing', () => {
  it('creates the three together: the first study is the PRIMARY one, its period is CURRENT and linked, subjects take the study type', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const res = await setup(
      agent,
      body({
        track: { type: 'UNIVERSITY', programKey: 'medicina' },
        period: { name: '2026-2', ...dates, studyLevel: 4 },
        subjects: ['Farmacología', 'Anatomía'],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['period', 'studyTrack', 'subjects']);
    expect(res.body.studyTrack).toMatchObject({
      name: 'Medicina',
      programKey: 'medicina',
      type: 'UNIVERSITY',
      isPrimary: true,
      status: 'ACTIVE',
    });
    expect(res.body.period).toMatchObject({
      name: '2026-2',
      isCurrent: true,
      studyLevel: 4,
      studyLevelNote: null,
      studyTrackId: res.body.studyTrack.id,
    });
    expect(res.body.subjects.map((s: { name: string }) => s.name)).toEqual([
      'Farmacología',
      'Anatomía',
    ]);
    // the subjects live in THAT period and carry the study's type, with colors the server picked
    for (const s of res.body.subjects) {
      expect(s.periodId).toBe(res.body.period.id);
      expect(s.educationContext).toBe('UNIVERSITY');
    }
    expect(new Set(res.body.subjects.map((s: { color: string }) => s.color)).size).toBe(2);
    // and it is the HOME period (the first study is the primary one)
    expect((await home(agent)).id).toBe(res.body.period.id);
    expect(await prisma.studyTrack.count({ where: { userId: user.id, isPrimary: true } })).toBe(1);
  });

  it('a SECOND study is not primary, becomes the current period of its own scope and does not take HOME', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const first = (await setup(agent, body({ track: { name: 'Medicina', type: 'UNIVERSITY' } })))
      .body;
    const second = (await setup(agent, body())).body;
    expect(second.studyTrack.isPrimary).toBe(false);
    expect(second.period.isCurrent).toBe(true);
    expect((await home(agent)).id).toBe(first.period.id);
    expect((await current(agent)).map((c) => c.period.id)).toEqual([
      first.period.id,
      second.period.id,
    ]);
  });

  it('works for a school, a catalog-less university study and another study; the name is the typed one, no key', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const school = (await setup(agent, body({ track: { name: 'Colegio', type: 'SCHOOL' } }))).body;
    expect(school.studyTrack).toMatchObject({ name: 'Colegio', type: 'SCHOOL', programKey: null });
    const custom = (
      await setup(agent, body({ track: { name: 'Mi carrera rara', type: 'UNIVERSITY' } }))
    ).body;
    expect(custom.studyTrack).toMatchObject({ programKey: null, name: 'Mi carrera rara' });
    const other = (
      await setup(agent, body({ track: { name: 'Inglés B2', type: 'OTHER_ACADEMIC' } }))
    ).body;
    expect(other.studyTrack.type).toBe('OTHER_ACADEMIC');
  });

  it('the level is a number OR a note, and optional', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const note = (
      await setup(agent, body({ period: { name: 'P', ...dates, studyLevelNote: 'Internado' } }))
    ).body.period;
    expect(note).toMatchObject({ studyLevel: null, studyLevelNote: 'Internado' });
    const none = (await setup(agent, body())).body.period;
    expect(none).toMatchObject({ studyLevel: null, studyLevelNote: null });
    const both = await setup(
      agent,
      body({ period: { name: 'P', ...dates, studyLevel: 3, studyLevelNote: 'x' } }),
    );
    expect(both.status).toBe(400);
  });

  it('validates the period (name, dates, order) and the study (name or key) before writing anything', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const cases: object[] = [
      body({ period: { name: '', ...dates } }),
      body({ period: { name: 'P', startDate: '2026-12-01', endDate: '2026-08-01' } }),
      body({ period: { name: 'P', startDate: 'mañana', endDate: '2026-08-01' } }),
      body({ track: { type: 'SCHOOL' } }), // no name, no key
      body({ track: { name: 'X', type: 'PERSONAL' } }), // not a study type
      body({ track: { programKey: 'no-existe', type: 'UNIVERSITY' } }),
      body({ period: undefined }),
      body({ track: undefined }),
    ];
    for (const c of cases) expect((await setup(agent, c)).status).toBe(400);
    expect(await prisma.studyTrack.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.academicPeriod.count({ where: { userId: user.id } })).toBe(0);
  });

  it('subjects are optional, de-duplicated by name key, capped at 30', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const none = await setup(agent, body());
    expect(none.body.subjects).toEqual([]);
    const dup = await setup(agent, body({ subjects: ['Farmacología', ' farmacologia ', 'Redes'] }));
    expect(dup.body.subjects.map((s: { name: string }) => s.name)).toEqual([
      'Farmacología',
      'Redes',
    ]);
    const many = Array.from({ length: 31 }, (_, i) => `Materia ${i}`);
    expect((await setup(agent, body({ subjects: many }))).status).toBe(400);
  });

  it('is STRICT at every level: no owner, primary flag, status, period id, study id, context or colors from the client', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const other = await signUp(app, 'b@example.com');
    const injections: [string, object][] = [
      ['userId', body({ userId: other.user.id })],
      ['track.userId', body({ track: { name: 'X', type: 'SCHOOL', userId: other.user.id } })],
      ['track.isPrimary', body({ track: { name: 'X', type: 'SCHOOL', isPrimary: true } })],
      ['track.status', body({ track: { name: 'X', type: 'SCHOOL', status: 'ARCHIVED' } })],
      ['track.id', body({ track: { name: 'X', type: 'SCHOOL', id: randomUUID() } })],
      ['period.id', body({ period: { name: 'P', ...dates, id: randomUUID() } })],
      ['period.isCurrent', body({ period: { name: 'P', ...dates, isCurrent: false } })],
      [
        'period.studyTrackId',
        body({ period: { name: 'P', ...dates, studyTrackId: randomUUID() } }),
      ],
      ['period.userId', body({ period: { name: 'P', ...dates, userId: other.user.id } })],
      ['periodId', body({ periodId: randomUUID() })],
      ['studyTrackId', body({ studyTrackId: randomUUID() })],
      ['educationContext', body({ educationContext: 'SCHOOL' })],
      ['subjects as objects', body({ subjects: [{ name: 'X', color: '#EF4444' }] })],
    ];
    for (const [key, payload] of injections) {
      const res = await setup(agent, payload);
      expect(res.status, key).toBe(400);
    }
    expect(await prisma.studyTrack.count()).toBe(0);
    expect(await prisma.academicPeriod.count()).toBe(0);
    expect(user.id).not.toBe(other.user.id);
  });

  it('needs a session, and the owner is the session (another user never sees it)', async () => {
    await request(app).post('/api/study-tracks/setup').send(body()).expect(401);
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    await setup(a.agent, body()).expect(201);
    expect(await tracks(b.agent)).toEqual([]);
    expect(await current(b.agent)).toEqual([]);
  });

  it('ROLLS BACK everything when a subject cannot be created (no study, no period, no earlier subject)', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_boom() RETURNS trigger AS $$
      BEGIN
        IF NEW."name" = 'BOOM' THEN RAISE EXCEPTION 'boom'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_boom BEFORE INSERT ON "Subject" FOR EACH ROW EXECUTE FUNCTION fail_boom();
    `);
    try {
      const res = await setup(agent, body({ subjects: ['Antes', 'BOOM'] }));
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_boom ON "Subject"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_boom()`);
    }
    expect(await prisma.studyTrack.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.academicPeriod.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.subject.count({ where: { userId: user.id } })).toBe(0);
    // and the account is intact: the same request now works
    await setup(agent, body({ subjects: ['Antes'] })).expect(201);
  });

  it('two setups at once from an account with NO study: exactly one primary', async () => {
    const { agent, user } = await signUp(app, 'a@example.com');
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        setup(agent, body({ track: { name: `Estudio ${i}`, type: 'SCHOOL' } })),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(await prisma.studyTrack.count({ where: { userId: user.id } })).toBe(4);
    expect(await prisma.studyTrack.count({ where: { userId: user.id, isPrimary: true } })).toBe(1);
    // one current period per study, and no scope with two
    expect(await prisma.academicPeriod.count({ where: { userId: user.id, isCurrent: true } })).toBe(
      4,
    );
  });

  it('after an ARCHIVED-only history the new study is primary again (zero active)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const first = (await setup(agent, body())).body.studyTrack;
    await agent.post(`/api/study-tracks/${first.id}/archive`).send({}).expect(200);
    const again = (await setup(agent, body({ track: { name: 'Otro', type: 'SCHOOL' } }))).body;
    expect(again.studyTrack.isPrimary).toBe(true);
  });
});

describe('POST /api/study-tracks/adopt-period: the existing planning becomes a study, nothing is copied', () => {
  /** The legacy account: a general current period with a subject, an activity and a class. */
  async function legacy(email = 'a@example.com') {
    const s = await signUp(app, email);
    const period = (await s.agent.post('/api/periods').send({ ...periodInput, studyLevel: 4 })).body
      .period;
    const subject = (
      await s.agent.post('/api/subjects').send({ periodId: period.id, name: 'Farmacología' })
    ).body.subject;
    const activity = (
      await s.agent
        .post('/api/activities')
        .send({ subjectId: subject.id, title: 'Parcial', dueDate: '2099-03-15' })
    ).body.activity;
    const block = (
      await s.agent.post('/api/schedule').send({
        type: 'CLASS',
        periodId: period.id,
        subjectId: subject.id,
        title: 'Clase',
        date: '2026-10-05',
        startTime: '08:00',
        endTime: '10:00',
      })
    ).body.block;
    return { ...s, period, subject, activity, block };
  }

  it('links the SAME period (id, dates, level) to a new primary study; subjects, activities and blocks are untouched', async () => {
    const l = await legacy();
    expect(l.period.studyTrackId).toBeNull();
    const res = await adopt(l.agent, {
      periodId: l.period.id,
      name: 'Medicina',
      type: 'UNIVERSITY',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.studyTrack).toMatchObject({ name: 'Medicina', isPrimary: true });
    expect(res.body.period).toMatchObject({
      id: l.period.id,
      name: l.period.name,
      startDate: l.period.startDate,
      endDate: l.period.endDate,
      studyLevel: 4,
      isCurrent: true,
      studyTrackId: res.body.studyTrack.id,
    });
    // nothing was recreated: the very same rows are still there, in the very same period
    expect(await prisma.academicPeriod.count({ where: { userId: l.user.id } })).toBe(1);
    expect(await prisma.subject.findUniqueOrThrow({ where: { id: l.subject.id } })).toMatchObject({
      periodId: l.period.id,
      name: 'Farmacología',
    });
    expect(await prisma.activity.findUniqueOrThrow({ where: { id: l.activity.id } })).toMatchObject(
      { periodId: l.period.id, subjectId: l.subject.id },
    );
    expect(
      await prisma.scheduleBlock.findUniqueOrThrow({ where: { id: l.block.id } }),
    ).toMatchObject({ periodId: l.period.id });
    expect(await prisma.subject.count({ where: { userId: l.user.id } })).toBe(1);
  });

  it('HOME keeps being the same period: the study is the primary one, so nobody is sent to the onboarding', async () => {
    const l = await legacy();
    expect((await home(l.agent)).id).toBe(l.period.id);
    await adopt(l.agent, { periodId: l.period.id, name: 'Medicina', type: 'UNIVERSITY' }).expect(
      201,
    );
    expect((await home(l.agent)).id).toBe(l.period.id);
    const [only] = await current(l.agent);
    expect(only?.period.id).toBe(l.period.id);
    expect(only?.studyTrack?.name).toBe('Medicina');
    // the summaries still read the same activity
    const dash = (await l.agent.get('/api/dashboard').expect(200)).body.dashboard;
    expect(dash.summary.total).toBe(1);
    expect(dash.subjectCount).toBe(1);
  });

  it('a catalog key brings its canonical name; the profile is NOT written', async () => {
    const l = await legacy();
    const before = (await l.agent.get('/api/profile').expect(200)).body.profile;
    const res = await adopt(l.agent, {
      periodId: l.period.id,
      programKey: 'medicina',
      type: 'UNIVERSITY',
    }).expect(201);
    expect(res.body.studyTrack).toMatchObject({ name: 'Medicina', programKey: 'medicina' });
    expect((await l.agent.get('/api/profile').expect(200)).body.profile).toEqual(before);
  });

  it('a period of somebody else and one that does not exist are the SAME 404; nothing is created', async () => {
    const a = await legacy('a@example.com');
    const b = await legacy('b@example.com');
    const foreign = await adopt(a.agent, {
      periodId: b.period.id,
      name: 'Hackeado',
      type: 'UNIVERSITY',
    });
    const missing = await adopt(a.agent, {
      periodId: randomUUID(),
      name: 'Hackeado',
      type: 'UNIVERSITY',
    });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(await prisma.studyTrack.count()).toBe(0);
    expect(
      (await prisma.academicPeriod.findUniqueOrThrow({ where: { id: b.period.id } })).studyTrackId,
    ).toBeNull();
  });

  it('a period that already belongs to a study is a 409 and creates no study', async () => {
    const l = await legacy();
    await adopt(l.agent, { periodId: l.period.id, name: 'Medicina', type: 'UNIVERSITY' }).expect(
      201,
    );
    const again = await adopt(l.agent, { periodId: l.period.id, name: 'Otra', type: 'SCHOOL' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PERIOD_ALREADY_IN_STUDY');
    expect(await prisma.studyTrack.count({ where: { userId: l.user.id } })).toBe(1);
  });

  it('adopting the same period twice AT ONCE: one wins, the other is a deterministic 409, never two studies owning it', async () => {
    const l = await legacy();
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        adopt(l.agent, { periodId: l.period.id, name: `Estudio ${i}`, type: 'UNIVERSITY' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('PERIOD_ALREADY_IN_STUDY');
    }
    expect(await prisma.studyTrack.count({ where: { userId: l.user.id } })).toBe(1);
    expect(await prisma.studyTrack.count({ where: { userId: l.user.id, isPrimary: true } })).toBe(
      1,
    );
  });

  it('a NON-current general period can be adopted too: it stays non-current and the HOME does not move', async () => {
    const l = await legacy();
    const old = (
      await l.agent
        .post('/api/periods')
        .send({ name: '2025-2', startDate: '2025-08-01', endDate: '2025-11-30' })
    ).body.period;
    expect(old.isCurrent).toBe(false);
    const res = await adopt(l.agent, {
      periodId: old.id,
      name: 'Diplomado',
      type: 'OTHER_ACADEMIC',
    });
    expect(res.status).toBe(201);
    expect(res.body.period.isCurrent).toBe(false);
    expect((await home(l.agent)).id).toBe(l.period.id);
  });

  it('adopting the general CURRENT period into a SECONDARY study never leaves the account without a HOME', async () => {
    const l = await legacy();
    // a primary study WITHOUT a current period: archiving a study clears its current period, restoring does not bring it back
    const first = (await setup(l.agent, body({ track: { name: 'Medicina', type: 'UNIVERSITY' } })))
      .body.studyTrack;
    await l.agent.post(`/api/study-tracks/${first.id}/archive`).send({}).expect(200);
    const restored = (
      await l.agent.post(`/api/study-tracks/${first.id}/restore`).send({}).expect(200)
    ).body.studyTracks.find((t: { id: string }) => t.id === first.id);
    expect(restored.isPrimary).toBe(true);
    // the primary has no current period: taking the general one into a SECOND study would leave no HOME
    const second = await setup(
      l.agent,
      body({ track: { name: 'Otro', type: 'SCHOOL' }, period: { name: 'Q', ...dates } }),
    );
    expect(second.status).toBe(201);
    const res = await adopt(l.agent, { periodId: l.period.id, name: 'Nuevo', type: 'UNIVERSITY' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRIMARY_STUDY_HAS_NO_CURRENT_PERIOD');
    expect((await home(l.agent)).id).toBe(l.period.id);
    expect(
      (await prisma.academicPeriod.findUniqueOrThrow({ where: { id: l.period.id } })).studyTrackId,
    ).toBeNull();
  });

  it('is strict (no owner, no primary flag, no status, no study id) and needs a session', async () => {
    const l = await legacy();
    await request(app).post('/api/study-tracks/adopt-period').send({}).expect(401);
    const base = { periodId: l.period.id, name: 'Medicina', type: 'UNIVERSITY' };
    for (const extra of [
      { userId: randomUUID() },
      { isPrimary: false },
      { status: 'ARCHIVED' },
      { studyTrackId: randomUUID() },
      { educationContext: 'SCHOOL' },
    ]) {
      expect((await adopt(l.agent, { ...base, ...extra })).status).toBe(400);
    }
    expect((await adopt(l.agent, { name: 'X', type: 'SCHOOL' })).status).toBe(400); // no period
    expect((await adopt(l.agent, { periodId: l.period.id, type: 'SCHOOL' })).status).toBe(400); // no name
    expect(await prisma.studyTrack.count()).toBe(0);
  });

  it('an account that already has an ARCHIVED-only history: the adopted study is the primary one', async () => {
    const l = await legacy();
    const t = (await setup(l.agent, body())).body.studyTrack;
    await l.agent.post(`/api/study-tracks/${t.id}/archive`).send({}).expect(200);
    const res = await adopt(l.agent, {
      periodId: l.period.id,
      name: 'Medicina',
      type: 'UNIVERSITY',
    });
    expect(res.body.studyTrack.isPrimary).toBe(true);
  });
});

describe('what the rest of the API already guaranteed keeps holding around these actions', () => {
  it('editing the type of a study never rewrites the subjects it created', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const made = (await setup(agent, body({ subjects: ['Redes'] }))).body;
    expect(made.subjects[0].educationContext).toBe('OTHER_ACADEMIC');
    await agent
      .patch(`/api/study-tracks/${made.studyTrack.id}`)
      .send({ type: 'SCHOOL' })
      .expect(200);
    const rows = (await agent.get('/api/subjects').query({ periodId: made.period.id }).expect(200))
      .body.subjects;
    expect(rows[0].educationContext).toBe('OTHER_ACADEMIC');
    // a subject created LATER, in the same period, takes the new type
    const later = (
      await agent.post('/api/subjects').send({ periodId: made.period.id, name: 'Nueva' })
    ).body.subject;
    expect(later.educationContext).toBe('SCHOOL');
  });

  it('archive keeps data and clears the current period; restore does not reactivate it; make-primary moves HOME', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const a = (await setup(agent, body({ track: { name: 'A', type: 'SCHOOL' } }))).body;
    const b = (await setup(agent, body({ track: { name: 'B', type: 'UNIVERSITY' } }))).body;
    expect((await home(agent)).id).toBe(a.period.id);
    await agent.post(`/api/study-tracks/${b.studyTrack.id}/make-primary`).send({}).expect(200);
    expect((await home(agent)).id).toBe(b.period.id);
    // the primary cannot leave while another is active
    const blocked = await agent.post(`/api/study-tracks/${b.studyTrack.id}/archive`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PRIMARY_TRACK_REQUIRES_REPLACEMENT');
    await agent.post(`/api/study-tracks/${a.studyTrack.id}/archive`).send({}).expect(200);
    expect((await current(agent)).map((c) => c.period.id)).toEqual([b.period.id]);
    await agent.post(`/api/study-tracks/${a.studyTrack.id}/restore`).send({}).expect(200);
    expect((await current(agent)).map((c) => c.period.id)).toEqual([b.period.id]); // not reactivated
    expect(await prisma.academicPeriod.count({ where: { id: a.period.id } })).toBe(1); // nothing deleted
  });
});
