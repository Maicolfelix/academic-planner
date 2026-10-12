import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, credentials, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

const app = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const EMPTY = {
  primaryUse: null,
  programName: null,
  programKey: null,
  onboardingStatus: 'NOT_STARTED',
};
const patch = (agent: request.Agent, body: unknown) =>
  agent.patch('/api/profile').send(body as object);
const profileOf = async (email: string) =>
  prisma.userProfile.findFirstOrThrow({ where: { user: { email } } });

describe('every account has exactly one profile', () => {
  it('registering creates the user AND an empty NOT_STARTED profile', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'ana@example.com', password: credentials.password });
    expect(res.status).toBe(201);
    const users = await prisma.user.findMany({ include: { profile: true } });
    expect(users).toHaveLength(1);
    expect(await prisma.userProfile.count()).toBe(1);
    expect(users[0]!.profile).toMatchObject({ userId: users[0]!.id, ...EMPTY });
  });

  it('a failure creating the profile rolls the whole registration back (no user, no session)', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION profile_test_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'profile creation failed on purpose'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER profile_test_fail BEFORE INSERT ON "UserProfile"
        FOR EACH ROW EXECUTE FUNCTION profile_test_fail();
    `);
    try {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: credentials.password });
      expect(res.status).toBe(500);
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.userProfile.count()).toBe(0);
      expect(await prisma.session.count()).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS profile_test_fail ON "UserProfile"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS profile_test_fail()`);
    }
    // and the same registration works once the fault is gone
    const again = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'ana@example.com', password: credentials.password });
    expect(again.status).toBe(201);
    expect(await prisma.userProfile.count()).toBe(1);
  });

  it('a duplicate e-mail still answers 409 and creates no profile', async () => {
    await signUp(app, 'ana@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Otra', email: 'ana@example.com', password: credentials.password });
    expect(res.status).toBe(409);
    expect(await prisma.userProfile.count()).toBe(1);
  });

  it('the public auth contract is intact: { user } with the same five fields, no profile inside', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'ana@example.com', password: credentials.password });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: credentials.password });
    const { agent } = await signUp(app, 'beto@example.com');
    const me = await agent.get('/api/auth/me');
    for (const body of [reg.body, login.body, me.body]) {
      expect(Object.keys(body)).toEqual(['user']);
      expect(Object.keys(body.user).sort()).toEqual(
        ['createdAt', 'email', 'id', 'name', 'timezone'].sort(),
      );
    }
  });

  it('deleting a user removes the profile with it', async () => {
    await signUp(app, 'ana@example.com');
    await signUp(app, 'beto@example.com');
    const ana = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@example.com' } });
    await prisma.user.delete({ where: { id: ana.id } });
    const left = await prisma.userProfile.findMany({ include: { user: true } });
    expect(left.map((p) => p.user.email)).toEqual(['beto@example.com']);
  });
});

describe('GET /api/profile', () => {
  it('needs a session', async () => {
    expect((await request(app).get('/api/profile')).status).toBe(401);
    expect((await request(app).patch('/api/profile').send({ primaryUse: 'PERSONAL' })).status).toBe(
      401,
    );
  });

  it('answers the session user’s profile, and never anyone else’s', async () => {
    const ana = await setupUser(app, 'ana@example.com');
    const beto = await setupUser(app, 'beto@example.com');
    await patch(ana.agent, { primaryUse: 'TEACHER', programName: 'Pedagogía' }).expect(200);
    const a = await ana.agent.get('/api/profile');
    const b = await beto.agent.get('/api/profile');
    expect(a.status).toBe(200);
    expect(a.body).toEqual({
      profile: {
        primaryUse: 'TEACHER',
        programName: 'Pedagogía',
        programKey: null,
        onboardingStatus: 'NOT_STARTED',
      },
    });
    expect(b.body).toEqual({ profile: EMPTY });
    expect(Object.keys(a.body.profile).sort()).toEqual(
      ['onboardingStatus', 'primaryUse', 'programKey', 'programName'].sort(),
    );
  });

  it('is private: no-store, also on errors', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    for (const res of [
      await agent.get('/api/profile'),
      await patch(agent, { primaryUse: 'PERSONAL' }),
      await patch(agent, { primaryUse: 'ADMIN' }),
      await request(app).get('/api/profile'),
    ]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('a missing row (it should never happen) is created empty, not answered with a 500', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    await prisma.userProfile.deleteMany();
    const res = await agent.get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual(EMPTY);
    expect(await prisma.userProfile.count()).toBe(1);
  });
});

describe('PATCH /api/profile', () => {
  it('sets the primary use, changes it and clears it', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    for (const primaryUse of [
      'UNIVERSITY_STUDENT',
      'SCHOOL_STUDENT',
      'OTHER_STUDENT',
      'TEACHER',
      'PERSONAL',
    ]) {
      const res = await patch(agent, { primaryUse });
      expect(res.status, primaryUse).toBe(200);
      expect(res.body.profile.primaryUse).toBe(primaryUse);
    }
    expect((await patch(agent, { primaryUse: null })).body.profile.primaryUse).toBeNull();
  });

  it('a partial update touches only what it names', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    await patch(agent, { primaryUse: 'UNIVERSITY_STUDENT', programKey: 'medicina' });
    const res = await patch(agent, { onboardingStatus: 'IN_PROGRESS' });
    expect(res.body.profile).toEqual({
      primaryUse: 'UNIVERSITY_STUDENT',
      programName: 'Medicina',
      programKey: 'medicina',
      onboardingStatus: 'IN_PROGRESS',
    });
  });

  it('a catalog program: the server derives the canonical name', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    const res = await patch(agent, { programKey: 'ingenieria-de-sistemas' });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      programKey: 'ingenieria-de-sistemas',
      programName: 'Ingeniería de Sistemas',
    });
    const withName = await patch(agent, { programKey: 'derecho', programName: 'Derecho' });
    expect(withName.body.profile).toMatchObject({ programKey: 'derecho', programName: 'Derecho' });
  });

  it('a key that does not match its name, an unknown key or a key with no name are refused', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    await patch(agent, { programKey: 'medicina' });
    for (const body of [
      { programKey: 'medicina', programName: 'Derecho' },
      { programKey: 'astrologia' },
      { programKey: 'medicina', programName: null },
      { programKey: '' },
      { programKey: 7 },
    ]) {
      const res = await patch(agent, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await profileOf('ana@example.com')).toMatchObject({
      programKey: 'medicina',
      programName: 'Medicina',
    });
  });

  it('a custom program has no key; a custom name replaces a catalog program and drops its key', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    await patch(agent, { programKey: 'medicina' });
    const res = await patch(agent, { programName: '  Medicina del Deporte  ' });
    expect(res.body.profile).toMatchObject({
      programKey: null,
      programName: 'Medicina del Deporte',
    });
    const detach = await patch(agent, { programKey: 'derecho' });
    expect(detach.body.profile.programName).toBe('Derecho');
    const onlyNull = await patch(agent, { programKey: null });
    expect(onlyNull.body.profile).toMatchObject({ programKey: null, programName: 'Derecho' });
  });

  it('clears the program with both null', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    await patch(agent, { programKey: 'medicina' });
    const res = await patch(agent, { programKey: null, programName: null });
    expect(res.body.profile).toMatchObject({ programKey: null, programName: null });
    await patch(agent, { programName: 'Algo' });
    expect((await patch(agent, { programName: null })).body.profile).toMatchObject({
      programKey: null,
      programName: null,
    });
  });

  it('refuses a program name of 0, 81 characters or with a NUL; 80 is fine', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    for (const programName of ['', '   ', 'x'.repeat(81), 'Med\u0000icina']) {
      expect((await patch(agent, { programName })).status, programName.slice(0, 8)).toBe(400);
    }
    expect((await patch(agent, { programName: 'x'.repeat(80) })).status).toBe(200);
  });

  it('refuses an invalid primary use or status, an empty body and a body that is not an object', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    for (const body of [
      { primaryUse: 'ADMIN' },
      { primaryUse: 'student' },
      { primaryUse: 3 },
      { onboardingStatus: 'DONE' },
      { onboardingStatus: 'NOT_STARTED' },
      {},
      [],
    ]) {
      expect((await patch(agent, body)).status, JSON.stringify(body)).toBe(400);
    }
    // a body that is not JSON at all is refused before it reaches the schema (415, as everywhere in the API)
    const text = await agent.patch('/api/profile').type('text/plain').send('texto');
    expect(text.status).toBe(415);
    expect(await profileOf('ana@example.com')).toMatchObject(EMPTY);
  });

  it('is strict: no owner, e-mail, timezone, role or any other field is ever accepted', async () => {
    const ana = await setupUser(app, 'ana@example.com');
    const beto = await setupUser(app, 'beto@example.com');
    const betoUser = await prisma.user.findUniqueOrThrow({ where: { email: 'beto@example.com' } });
    const usersBefore = JSON.stringify(await prisma.user.findMany({ orderBy: { email: 'asc' } }));
    for (const extra of [
      { userId: betoUser.id },
      { ownerId: betoUser.id },
      { id: betoUser.id },
      { email: 'robado@example.com' },
      { timezone: 'Asia/Tokyo' },
      { name: 'Otro' },
      { role: 'ADMIN' },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      { onboardingStatus: 'IN_PROGRESS', extra: true },
    ]) {
      const res = await patch(ana.agent, { primaryUse: 'PERSONAL', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    // nothing changed: not Ana's profile, not Beto's, not a single user column
    expect(await profileOf('ana@example.com')).toMatchObject(EMPTY);
    expect(await profileOf('beto@example.com')).toMatchObject(EMPTY);
    expect(JSON.stringify(await prisma.user.findMany({ orderBy: { email: 'asc' } }))).toBe(
      usersBefore,
    );
    expect((await beto.agent.get('/api/profile')).body.profile).toEqual(EMPTY);
  });

  it('changes only the session user’s profile', async () => {
    const ana = await setupUser(app, 'ana@example.com');
    await setupUser(app, 'beto@example.com');
    await patch(ana.agent, { primaryUse: 'PERSONAL', onboardingStatus: 'IN_PROGRESS' });
    expect(await profileOf('ana@example.com')).toMatchObject({ primaryUse: 'PERSONAL' });
    expect(await profileOf('beto@example.com')).toMatchObject(EMPTY);
  });
});

describe('onboarding status transitions', () => {
  const status = async (agent: request.Agent, onboardingStatus: string) =>
    patch(agent, { onboardingStatus });

  it('NOT_STARTED -> IN_PROGRESS -> COMPLETED, and COMPLETED -> IN_PROGRESS to edit again', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    expect((await status(agent, 'IN_PROGRESS')).body.profile.onboardingStatus).toBe('IN_PROGRESS');
    expect((await status(agent, 'COMPLETED')).body.profile.onboardingStatus).toBe('COMPLETED');
    expect((await status(agent, 'IN_PROGRESS')).body.profile.onboardingStatus).toBe('IN_PROGRESS');
  });

  it('can be skipped from NOT_STARTED and from IN_PROGRESS, and reopened', async () => {
    const a = await setupUser(app, 'ana@example.com');
    expect((await status(a.agent, 'SKIPPED')).body.profile.onboardingStatus).toBe('SKIPPED');
    expect((await status(a.agent, 'IN_PROGRESS')).body.profile.onboardingStatus).toBe(
      'IN_PROGRESS',
    );
    expect((await status(a.agent, 'SKIPPED')).body.profile.onboardingStatus).toBe('SKIPPED');
  });

  it('refuses the jumps that make no sense with 409, and keeps the state', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    const direct = await status(agent, 'COMPLETED'); // NOT_STARTED -> COMPLETED
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe('INVALID_ONBOARDING_TRANSITION');
    await status(agent, 'SKIPPED');
    expect((await status(agent, 'COMPLETED')).status).toBe(409); // SKIPPED -> COMPLETED
    await status(agent, 'IN_PROGRESS');
    await status(agent, 'COMPLETED');
    expect((await status(agent, 'SKIPPED')).status).toBe(409); // COMPLETED -> SKIPPED
    expect((await profileOf('ana@example.com')).onboardingStatus).toBe('COMPLETED');
  });

  it('asking for the state it already has is harmless', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    await status(agent, 'IN_PROGRESS');
    expect((await status(agent, 'IN_PROGRESS')).status).toBe(200);
  });

  it('a refused transition applies nothing of the same request (answers and status are one change)', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    const res = await patch(agent, { primaryUse: 'TEACHER', onboardingStatus: 'COMPLETED' });
    expect(res.status).toBe(409);
    expect(await profileOf('ana@example.com')).toMatchObject(EMPTY);
  });

  it('no status stops signing in or using the app', async () => {
    const { agent } = await setupUser(app, 'ana@example.com');
    for (const s of ['SKIPPED', 'IN_PROGRESS', 'COMPLETED']) {
      await status(agent, s);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
      expect((await agent.get('/api/periods')).status).toBe(200);
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: credentials.password });
      expect(login.status).toBe(200);
    }
  });
});
