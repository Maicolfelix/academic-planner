import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, prisma, resetDb, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
const dates = { startDate: '2026-08-03', endDate: '2026-11-28' };

const complete = (a: Agent, body: object = {}) => a.post('/api/onboarding/complete').send(body);
const profileOf = async (a: Agent) => (await a.get('/api/profile').expect(200)).body.profile;
const tracksOf = async (a: Agent) =>
  (await a.get('/api/study-tracks').expect(200)).body.studyTracks as {
    id: string;
    name: string;
    type: string;
    programKey: string | null;
    isPrimary: boolean;
    status: string;
  }[];

/**
 * An account in the middle of the onboarding: the answers the wizard saves as it goes (the use, the program, the status), the
 * period it creates (general: no study yet) and, optionally, a subject.
 */
async function wizard(
  email: string,
  answers: {
    use?: string | null;
    program?: { programKey?: string; programName?: string };
    period?: boolean;
    level?: number;
  } = {},
) {
  const s = await signUp(app, email);
  if (answers.use !== null) {
    await s.agent
      .patch('/api/profile')
      .send({ primaryUse: answers.use ?? 'UNIVERSITY_STUDENT', onboardingStatus: 'IN_PROGRESS' })
      .expect(200);
  }
  if (answers.program) await s.agent.patch('/api/profile').send(answers.program).expect(200);
  let period: { id: string } | undefined;
  if (answers.period !== false) {
    period = (
      await s.agent
        .post('/api/periods')
        .send({ name: '2026-2', ...dates, ...(answers.level && { studyLevel: answers.level }) })
        .expect(201)
    ).body.period;
  }
  return { ...s, period };
}

/** Everything the period owns, so "nothing was copied or moved" can be checked field by field. */
async function snapshot(periodId: string) {
  const period = await prisma.academicPeriod.findUniqueOrThrow({ where: { id: periodId } });
  return {
    period: { ...period, studyTrackId: undefined, updatedAt: undefined },
    subjects: (await prisma.subject.findMany({ where: { periodId }, orderBy: { id: 'asc' } })).map(
      (r) => ({ ...r }),
    ),
    activities: (
      await prisma.activity.findMany({ where: { periodId }, orderBy: { id: 'asc' } })
    ).map((r) => ({ ...r })),
    blocks: (
      await prisma.scheduleBlock.findMany({ where: { periodId }, orderBy: { id: 'asc' } })
    ).map((r) => ({ ...r })),
    reminders: await prisma.reminder.count({ where: { activity: { periodId } } }),
  };
}

describe('POST /api/onboarding/complete: a student who studies ends with a PRIMARY study, and the period is adopted', () => {
  it('a university student with a catalog program: the study is that program, primary, and the SAME period becomes its own', async () => {
    const w = await wizard('a@example.com', {
      program: { programKey: 'medicina' },
      level: 4,
    });
    const before = await snapshot(w.period!.id);
    // nothing exists while the student is still answering (the program, the period, the level)
    expect(await tracksOf(w.agent)).toEqual([]);

    const res = await complete(w.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['period', 'profile', 'studyTrack']);
    expect(res.body.studyTrack).toMatchObject({
      name: 'Medicina',
      type: 'UNIVERSITY',
      programKey: 'medicina',
      isPrimary: true,
      status: 'ACTIVE',
    });
    expect(res.body.profile.onboardingStatus).toBe('COMPLETED');
    expect(res.body.period).toMatchObject({
      id: w.period!.id,
      studyTrackId: res.body.studyTrack.id,
      isCurrent: true,
      studyLevel: 4,
    });
    expect(JSON.stringify(res.body)).not.toContain(w.user.id); // never the owner
    // the period was adopted in place: only its link changed (id, dates, level, current flag and everything it owns are intact)
    expect(await snapshot(w.period!.id)).toEqual(before);
    expect(await prisma.academicPeriod.count({ where: { userId: w.user.id } })).toBe(1);
    expect((await tracksOf(w.agent)).map((t) => t.name)).toEqual(['Medicina']);
    // and it is still the HOME period (nobody is sent back to the onboarding)
    expect((await w.agent.get('/api/periods/home').expect(200)).body.period.id).toBe(w.period!.id);
  });

  it('a program of their own: its name, no key; no program: "Universidad"', async () => {
    const custom = await wizard('a@example.com', { program: { programName: 'Mi carrera rara' } });
    expect((await complete(custom.agent).expect(200)).body.studyTrack).toMatchObject({
      name: 'Mi carrera rara',
      programKey: null,
      type: 'UNIVERSITY',
    });
    const none = await wizard('b@example.com');
    expect((await complete(none.agent).expect(200)).body.studyTrack).toMatchObject({
      name: 'Universidad',
      programKey: null,
      type: 'UNIVERSITY',
    });
  });

  it('school: "Colegio" (the school flow never asks for a program, so a stale one is not used)', async () => {
    const w = await wizard('a@example.com', {
      use: 'SCHOOL_STUDENT',
      program: { programName: 'Medicina' }, // left over from an earlier answer
    });
    expect((await complete(w.agent).expect(200)).body.studyTrack).toMatchObject({
      name: 'Colegio',
      type: 'SCHOOL',
      programKey: null,
      isPrimary: true,
    });
  });

  it('other study: the program or course they named, else "Otro estudio"', async () => {
    const named = await wizard('a@example.com', {
      use: 'OTHER_STUDENT',
      program: { programName: 'Inglés B2' },
    });
    expect((await complete(named.agent).expect(200)).body.studyTrack).toMatchObject({
      name: 'Inglés B2',
      type: 'OTHER_ACADEMIC',
      programKey: null,
    });
    const bare = await wizard('b@example.com', { use: 'OTHER_STUDENT' });
    expect((await complete(bare.agent).expect(200)).body.studyTrack).toMatchObject({
      name: 'Otro estudio',
      type: 'OTHER_ACADEMIC',
    });
  });

  it('teacher and personal use: the onboarding is completed and NO study is created (their period stays general)', async () => {
    for (const [i, use] of ['TEACHER', 'PERSONAL'].entries()) {
      const w = await wizard(`t${i}@example.com`, { use });
      const res = await complete(w.agent).expect(200);
      expect(res.body.studyTrack).toBeNull();
      expect(res.body.profile.onboardingStatus).toBe('COMPLETED');
      expect(await tracksOf(w.agent)).toEqual([]);
      expect(res.body.period).toMatchObject({ id: w.period!.id, studyTrackId: null });
    }
  });

  it('a skipped profile (no answer): no study, and the status is NOT changed (it stays as it was)', async () => {
    const w = await wizard('a@example.com', { use: null });
    await w.agent.patch('/api/profile').send({ onboardingStatus: 'SKIPPED' }).expect(200);
    const res = await complete(w.agent).expect(200);
    expect(res.body.studyTrack).toBeNull();
    expect(res.body.profile).toMatchObject({ primaryUse: null, onboardingStatus: 'SKIPPED' });
    expect(await tracksOf(w.agent)).toEqual([]);
  });

  it('subjects, activities, blocks and reminders stay in the period, untouched; a subject keeps the context it was created with', async () => {
    const w = await wizard('a@example.com', { use: 'PERSONAL' }); // a personal use: its subjects default to OTHER_ACADEMIC
    const subject = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period!.id, name: 'Farmacología' })
        .expect(201)
    ).body.subject;
    expect(subject.educationContext).toBe('OTHER_ACADEMIC');
    const activity = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: subject.id, title: 'Parcial', dueDate: '2099-03-15', type: 'EXAM' })
        .expect(201)
    ).body.activity;
    await w.agent
      .post('/api/schedule')
      .send({
        type: 'CLASS',
        periodId: w.period!.id,
        subjectId: subject.id,
        title: 'Clase',
        date: '2026-10-05',
        startTime: '08:00',
        endTime: '10:00',
      })
      .expect(201);
    // the student then says they study at a university and completes
    await w.agent.patch('/api/profile').send({ primaryUse: 'UNIVERSITY_STUDENT' }).expect(200);
    const before = await snapshot(w.period!.id);
    expect(before.subjects).toHaveLength(1);
    expect(before.activities).toHaveLength(1);
    expect(before.blocks).toHaveLength(1);
    expect(before.reminders).toBeGreaterThan(0);

    await complete(w.agent).expect(200);
    expect(await snapshot(w.period!.id)).toEqual(before); // nothing copied, recreated or rewritten
    const kept = await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } });
    expect(kept.educationContext).toBe('OTHER_ACADEMIC'); // the P0-3 snapshot stands: no backfill
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: activity.id } })).periodId).toBe(
      w.period!.id,
    );
    // a NEW subject afterwards follows the study's type
    const later = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period!.id, name: 'Anatomía' })
        .expect(201)
    ).body.subject;
    expect(later.educationContext).toBe('UNIVERSITY');
  });
});

describe('what completing never overrides, and what it refuses', () => {
  it('the student already set up a study in Mis estudios: no second study, the primary one does not change, the onboarding is just completed', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const mine = (
      await w.agent
        .post('/api/study-tracks')
        .send({ name: 'Diplomado', type: 'OTHER_ACADEMIC' })
        .expect(201)
    ).body.studyTrack;
    const res = await complete(w.agent).expect(200);
    expect(res.body.profile.onboardingStatus).toBe('COMPLETED');
    const tracks = await tracksOf(w.agent);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id: mine.id, name: 'Diplomado', isPrimary: true });
    // their explicit setup wins: the period they made is still general (completing does not link it)
    expect(res.body.period.studyTrackId).toBeNull();
    expect(res.body.studyTrack).toBeNull();
  });

  it('HOME already belongs to a study: nothing is created, renamed, retyped or re-primaried', async () => {
    const w = await wizard('a@example.com', {
      use: 'UNIVERSITY_STUDENT',
      program: { programKey: 'medicina' },
      period: false,
    });
    const setup = (
      await w.agent
        .post('/api/study-tracks/setup')
        .send({
          track: { name: 'Inglés', type: 'OTHER_ACADEMIC' },
          period: { name: 'Módulo 1', ...dates },
        })
        .expect(201)
    ).body;
    const before = await tracksOf(w.agent);
    const res = await complete(w.agent).expect(200);
    expect(await tracksOf(w.agent)).toEqual(before);
    expect(res.body.studyTrack).toMatchObject({ id: setup.studyTrack.id, name: 'Inglés' });
    expect(res.body.period.id).toBe(setup.period.id);
  });

  it('a study that was ARCHIVED still counts as "set up a study": nothing is created', async () => {
    const w = await wizard('a@example.com');
    const t = (
      await w.agent.post('/api/study-tracks').send({ name: 'Viejo', type: 'SCHOOL' }).expect(201)
    ).body.studyTrack;
    await w.agent.post(`/api/study-tracks/${t.id}/archive`).send({}).expect(200);
    await complete(w.agent).expect(200);
    expect(await tracksOf(w.agent)).toHaveLength(1);
  });

  it('without a HOME period it is a 409 NO_CURRENT_PERIOD, for every use, and the status is NOT changed', async () => {
    for (const [i, use] of [
      'UNIVERSITY_STUDENT',
      'SCHOOL_STUDENT',
      'OTHER_STUDENT',
      'TEACHER',
      'PERSONAL',
    ].entries()) {
      const w = await wizard(`n${i}@example.com`, { use, period: false });
      const res = await complete(w.agent);
      expect(res.status, use).toBe(409);
      expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
      expect(await profileOf(w.agent)).toMatchObject({ onboardingStatus: 'IN_PROGRESS' });
      expect(await tracksOf(w.agent)).toEqual([]);
    }
  });

  it('is idempotent: a retry or a double tap returns the current state and writes nothing', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const first = await complete(w.agent).expect(200);
    const again = await complete(w.agent).expect(200);
    expect(again.body.studyTrack).toEqual(first.body.studyTrack);
    expect(again.body.period).toEqual(first.body.period);
    expect(again.body.profile).toEqual(first.body.profile);
    expect(await tracksOf(w.agent)).toHaveLength(1);
    // and even if somebody renames the study meanwhile, a retry does not recreate or rename anything
    await w.agent
      .patch(`/api/study-tracks/${first.body.studyTrack.id}`)
      .send({ name: 'Mi Medicina' })
      .expect(200);
    const third = await complete(w.agent).expect(200);
    expect(third.body.studyTrack.name).toBe('Mi Medicina');
    expect(await tracksOf(w.agent)).toHaveLength(1);
  });

  it('the body is empty and strict: no owner, profile fields, ids, type or name are ever read', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const other = await signUp(app, 'b@example.com');
    for (const extra of [
      { userId: other.user.id },
      { primaryUse: 'TEACHER' },
      { programName: 'Derecho' },
      { programKey: 'derecho' },
      { periodId: w.period!.id },
      { studyTrackId: randomUUID() },
      { isPrimary: false },
      { type: 'SCHOOL' },
      { name: 'Hackeado' },
    ]) {
      expect((await complete(w.agent, extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect(await tracksOf(w.agent)).toEqual([]);
    expect(await profileOf(w.agent)).toMatchObject({ onboardingStatus: 'IN_PROGRESS' });
  });

  it('needs a session, answers no-store, and one user never touches another', async () => {
    await request(app).post('/api/onboarding/complete').send({}).expect(401);
    const a = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const b = await wizard('b@example.com', { use: 'SCHOOL_STUDENT' });
    const res = await complete(a.agent).expect(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(await tracksOf(b.agent)).toEqual([]);
    expect(await profileOf(b.agent)).toMatchObject({ onboardingStatus: 'IN_PROGRESS' });
  });
});

describe('all or nothing, and no race', () => {
  const fail = async (table: string, when: string, name: string) => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${name} BEFORE ${when} ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}();
    `);
    return async () => {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    };
  };

  it('if marking the profile COMPLETED fails, the study and the adoption are rolled back', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const undo = await fail('UserProfile', 'UPDATE OF "onboardingStatus"', 'fail_completed');
    try {
      expect((await complete(w.agent)).status).toBeGreaterThanOrEqual(500);
    } finally {
      await undo();
    }
    expect(await prisma.studyTrack.count({ where: { userId: w.user.id } })).toBe(0);
    expect(
      (await prisma.academicPeriod.findUniqueOrThrow({ where: { id: w.period!.id } })).studyTrackId,
    ).toBeNull();
    expect(await profileOf(w.agent)).toMatchObject({ onboardingStatus: 'IN_PROGRESS' });
    // and the retry works
    await complete(w.agent).expect(200);
    expect(await tracksOf(w.agent)).toHaveLength(1);
  });

  it('if creating the study fails, the onboarding is NOT left COMPLETED', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const undo = await fail('StudyTrack', 'INSERT', 'fail_track');
    try {
      expect((await complete(w.agent)).status).toBeGreaterThanOrEqual(500);
    } finally {
      await undo();
    }
    expect(await profileOf(w.agent)).toMatchObject({ onboardingStatus: 'IN_PROGRESS' });
    expect(await prisma.studyTrack.count({ where: { userId: w.user.id } })).toBe(0);
  });

  it('simultaneous completions (a double tap, a retry after a timeout) create exactly ONE study', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const results = await Promise.all(Array.from({ length: 5 }, () => complete(w.agent)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await prisma.studyTrack.count({ where: { userId: w.user.id } })).toBe(1);
    expect(await prisma.studyTrack.count({ where: { userId: w.user.id, isPrimary: true } })).toBe(
      1,
    );
    expect(new Set(results.map((r) => r.body.studyTrack.id)).size).toBe(1);
  });

  it('a completion and a study setup at the same time keep every invariant (one primary, one current period per scope)', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const [done, setup] = await Promise.all([
      complete(w.agent),
      w.agent.post('/api/study-tracks/setup').send({
        track: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
        period: { name: 'Cohorte', ...dates },
      }),
    ]);
    expect(done.status).toBe(200);
    expect(setup.status).toBe(201);
    const tracks = await tracksOf(w.agent);
    expect(tracks.length).toBeGreaterThanOrEqual(1);
    expect(tracks.length).toBeLessThanOrEqual(2);
    expect(tracks.filter((t) => t.isPrimary)).toHaveLength(1);
    const currents = await prisma.academicPeriod.findMany({
      where: { userId: w.user.id, isCurrent: true },
    });
    expect(new Set(currents.map((p) => p.studyTrackId)).size).toBe(currents.length);
    expect(await profileOf(w.agent)).toMatchObject({ onboardingStatus: 'COMPLETED' });
  });
});

describe('the profile program stops being an authority once a study exists (no dual write)', () => {
  it('with a study, PATCH /api/profile cannot change programName or programKey (409), and the profile is not touched', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    await complete(w.agent).expect(200);
    const before = await profileOf(w.agent);
    for (const body of [
      { programName: 'Derecho' },
      { programKey: 'derecho' },
      { programName: null, programKey: null },
    ]) {
      const res = await w.agent.patch('/api/profile').send(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body.error.code).toBe('PROGRAM_MANAGED_BY_STUDY');
      expect(res.body.error.message).toBe('Tu programa se administra desde Mis estudios.');
    }
    expect(await profileOf(w.agent)).toEqual(before);
  });

  it('a study that is ARCHIVED still blocks it; with NO study it works as always (the onboarding stages the program there)', async () => {
    const w = await wizard('a@example.com');
    await w.agent.patch('/api/profile').send({ programKey: 'medicina' }).expect(200);
    await w.agent.patch('/api/profile').send({ programName: 'Mi carrera' }).expect(200);
    const t = (
      await w.agent.post('/api/study-tracks').send({ name: 'X', type: 'SCHOOL' }).expect(201)
    ).body.studyTrack;
    await w.agent.post(`/api/study-tracks/${t.id}/archive`).send({}).expect(200);
    expect((await w.agent.patch('/api/profile').send({ programName: 'Otra' })).status).toBe(409);
  });

  it('primaryUse and the onboarding status stay editable, and changing primaryUse never touches a study', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    await complete(w.agent).expect(200);
    const before = await tracksOf(w.agent);
    await w.agent.patch('/api/profile').send({ primaryUse: 'PERSONAL' }).expect(200);
    expect(await tracksOf(w.agent)).toEqual(before);
    expect(await profileOf(w.agent)).toMatchObject({ primaryUse: 'PERSONAL' });
  });

  it('renaming or retyping a study never writes the profile (and the profile is not the study)', async () => {
    const w = await wizard('a@example.com', { program: { programKey: 'medicina' } });
    const { studyTrack } = (await complete(w.agent).expect(200)).body;
    const before = await profileOf(w.agent);
    await w.agent
      .patch(`/api/study-tracks/${studyTrack.id}`)
      .send({ name: 'Mi carrera', type: 'OTHER_ACADEMIC' })
      .expect(200);
    expect(await profileOf(w.agent)).toEqual(before); // still the staged program: legacy metadata, not kept in step
  });
});

describe('older accounts are never migrated silently', () => {
  /** An account from before the studies: finished onboarding, a program, a general current period, no study. */
  async function legacy(email = 'old@example.com') {
    const w = await wizard(email, { program: { programKey: 'medicina' }, level: 4 });
    await w.agent.patch('/api/profile').send({ onboardingStatus: 'COMPLETED' }).expect(200);
    return w;
  }

  it('signing in, reading the profile, the studies, the periods and the Home never creates a study or writes anything', async () => {
    const w = await legacy();
    const login = request.agent(app);
    await login
      .post('/api/auth/login')
      .send({ email: 'old@example.com', password: 'correct horse battery' })
      .expect(200);
    const before = await prisma.userProfile.findUniqueOrThrow({ where: { userId: w.user.id } });
    const period = await prisma.academicPeriod.findUniqueOrThrow({ where: { id: w.period!.id } });
    for (const path of [
      '/api/auth/me',
      '/api/profile',
      '/api/study-tracks',
      '/api/periods',
      '/api/periods/home',
      '/api/periods/current',
      '/api/dashboard',
      '/api/subjects?scope=current',
    ]) {
      await login.get(path).expect(200);
    }
    expect(await tracksOf(login)).toEqual([]);
    expect(await prisma.studyTrack.count({ where: { userId: w.user.id } })).toBe(0);
    expect(await prisma.userProfile.findUniqueOrThrow({ where: { userId: w.user.id } })).toEqual(
      before,
    );
    expect(await prisma.academicPeriod.findUniqueOrThrow({ where: { id: w.period!.id } })).toEqual(
      period,
    );
  });

  it('even completing again (reopening the onboarding) leaves an account that already finished exactly as it was', async () => {
    const w = await legacy();
    const res = await complete(w.agent).expect(200);
    expect(res.body.studyTrack).toBeNull();
    expect(res.body.period).toMatchObject({ id: w.period!.id, studyTrackId: null });
    expect(await tracksOf(w.agent)).toEqual([]);
    // the way to turn it into a study is the explicit one: Mis estudios -> "Convertir en estudio" (adopt-period)
    await w.agent
      .post('/api/study-tracks/adopt-period')
      .send({ periodId: w.period!.id, programKey: 'medicina', type: 'UNIVERSITY' })
      .expect(201);
    expect(await tracksOf(w.agent)).toHaveLength(1);
  });

  it('the program of an older account still works as the proposal for Convertir while it has no study, and the profile is editable', async () => {
    const w = await legacy();
    await w.agent.patch('/api/profile').send({ programName: 'Mi carrera' }).expect(200);
    expect(await profileOf(w.agent)).toMatchObject({ programName: 'Mi carrera', programKey: null });
  });
});

describe('registration', () => {
  it('creates the account with its profile and NO study: nobody knows yet what they study', async () => {
    const s = await signUp(app, 'new@example.com');
    expect(await prisma.userProfile.count({ where: { userId: s.user.id } })).toBe(1);
    expect(await prisma.studyTrack.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await profileOf(s.agent)).toMatchObject({
      primaryUse: null,
      onboardingStatus: 'NOT_STARTED',
    });
  });
});
