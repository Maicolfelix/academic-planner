import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, setupUser, signUp } from '../../test/helpers.js';

const app = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

// Names chosen to prove that nothing depends on WHICH subject it is.
const NAMES = [
  'Anatomía',
  'Filosofía',
  'Asignatura Experimental 847',
  'Diseño de Sistemas Distribuidos',
  'Taller de Escritura',
  'Estadística Aplicada',
];

const useIs = (agent: request.Agent, primaryUse: string | null) =>
  agent.patch('/api/profile').send({ primaryUse }).expect(200);
const withPeriod = async (email: string, primaryUse: string | null) => {
  const s = await signUp(app, email);
  const period = (await s.agent.post('/api/periods').send(periodInput)).body.period;
  if (primaryUse !== null) await useIs(s.agent, primaryUse);
  return { ...s, period };
};
const create = (agent: request.Agent, periodId: string, name: string, extra: object = {}) =>
  agent.post('/api/subjects').send({ periodId, name, ...extra });

describe('a subject created by hand takes the default of the primary use', () => {
  it.each([
    ['UNIVERSITY_STUDENT', 'UNIVERSITY'],
    ['SCHOOL_STUDENT', 'SCHOOL'],
    ['OTHER_STUDENT', 'OTHER_ACADEMIC'],
    ['TEACHER', 'OTHER_ACADEMIC'],
    ['PERSONAL', 'OTHER_ACADEMIC'],
  ])('%s -> %s, whatever the subject is called', async (use, expected) => {
    const { agent, period } = await withPeriod(`${use}@example.com`, use);
    for (const name of NAMES) {
      const res = await create(agent, period.id, name);
      expect(res.status, name).toBe(201);
      expect(res.body.subject.educationContext, name).toBe(expected);
    }
  });

  it('without a primary use (every older account) it is null: nothing is invented', async () => {
    const { agent, period } = await withPeriod('old@example.com', null);
    const res = await create(agent, period.id, 'Anatomía');
    expect(res.status).toBe(201);
    expect(res.body.subject.educationContext).toBeNull();
    expect(
      (await prisma.subject.findUniqueOrThrow({ where: { id: res.body.subject.id } }))
        .educationContext,
    ).toBeNull();
  });

  it('an explicit context wins over the default, and an explicit null means not specified', async () => {
    const { agent, period } = await withPeriod('u@example.com', 'UNIVERSITY_STUDENT');
    const english = await create(agent, period.id, 'Curso de Inglés Cambridge', {
      educationContext: 'OTHER_ACADEMIC',
    });
    expect(english.body.subject.educationContext).toBe('OTHER_ACADEMIC');
    const school = await create(agent, period.id, 'Otra', { educationContext: 'SCHOOL' });
    expect(school.body.subject.educationContext).toBe('SCHOOL');
    const none = await create(agent, period.id, 'Sin clasificar', { educationContext: null });
    expect(none.body.subject.educationContext).toBeNull();
  });

  it('refuses an invalid context (there is no personal one) and creates nothing', async () => {
    const { agent, period } = await withPeriod('u@example.com', 'UNIVERSITY_STUDENT');
    for (const educationContext of ['PERSONAL', 'university', '', 3, true]) {
      const res = await create(agent, period.id, 'X', { educationContext });
      expect(res.status, String(educationContext)).toBe(400);
    }
    expect(await prisma.subject.count()).toBe(0);
  });

  it('keeps the contract: name, color, professor, description and period work as before', async () => {
    const { agent, period } = await withPeriod('u@example.com', 'SCHOOL_STUDENT');
    const res = await create(agent, period.id, 'Química', {
      color: '#EF4444',
      professor: 'Ana',
      description: 'Lab',
    });
    expect(res.body.subject).toMatchObject({
      periodId: period.id,
      name: 'Química',
      color: '#EF4444',
      professor: 'Ana',
      description: 'Lab',
      educationContext: 'SCHOOL',
    });
    expect((await create(agent, period.id, 'química')).status).toBe(409); // duplicates still refused by hand
  });

  it('reading a subject always carries the field', async () => {
    const { agent, period } = await withPeriod('u@example.com', 'UNIVERSITY_STUDENT');
    const id = (await create(agent, period.id, 'Anatomía')).body.subject.id;
    expect((await agent.get(`/api/subjects/${id}`)).body.subject.educationContext).toBe(
      'UNIVERSITY',
    );
    expect(
      (await agent.get('/api/subjects')).body.subjects.map(
        (s: { educationContext: string }) => s.educationContext,
      ),
    ).toEqual(['UNIVERSITY']);
  });
});

describe('updating the context of a subject', () => {
  it('sets it, changes it and clears it, without touching anything else', async () => {
    const { agent, period } = await withPeriod('u@example.com', null);
    const made = (await create(agent, period.id, 'Anatomía', { color: '#EF4444' })).body.subject;
    const set = await agent
      .patch(`/api/subjects/${made.id}`)
      .send({ educationContext: 'UNIVERSITY' });
    expect(set.status).toBe(200);
    expect(set.body.subject).toMatchObject({
      educationContext: 'UNIVERSITY',
      name: 'Anatomía',
      color: '#EF4444',
      periodId: period.id,
    });
    const change = await agent
      .patch(`/api/subjects/${made.id}`)
      .send({ educationContext: 'OTHER_ACADEMIC' });
    expect(change.body.subject.educationContext).toBe('OTHER_ACADEMIC');
    const clear = await agent.patch(`/api/subjects/${made.id}`).send({ educationContext: null });
    expect(clear.body.subject.educationContext).toBeNull();
    const rename = await agent.patch(`/api/subjects/${made.id}`).send({ name: 'Anatomía II' });
    expect(rename.body.subject.educationContext).toBeNull(); // not mentioning it leaves it
  });

  it('refuses an invalid context and a period change; another user gets the same 404', async () => {
    const owner = await withPeriod('owner@example.com', 'UNIVERSITY_STUDENT');
    const other = await signUp(app, 'other@example.com');
    const id = (await create(owner.agent, owner.period.id, 'Anatomía')).body.subject.id;
    expect(
      (await owner.agent.patch(`/api/subjects/${id}`).send({ educationContext: 'PERSONAL' }))
        .status,
    ).toBe(400);
    expect(
      (await owner.agent.patch(`/api/subjects/${id}`).send({ periodId: owner.period.id })).status,
    ).toBe(400);
    const foreign = await other.agent
      .patch(`/api/subjects/${id}`)
      .send({ educationContext: 'SCHOOL' });
    expect(foreign.status).toBe(404);
    expect((await prisma.subject.findUniqueOrThrow({ where: { id } })).educationContext).toBe(
      'UNIVERSITY',
    );
  });
});

describe('the primary use is only the default of NEW subjects', () => {
  it('changing it never changes the subjects that already exist', async () => {
    const { agent, period } = await withPeriod('u@example.com', 'UNIVERSITY_STUDENT');
    const before = (await create(agent, period.id, 'Anatomía')).body.subject;
    await useIs(agent, 'PERSONAL');
    expect((await agent.get(`/api/subjects/${before.id}`)).body.subject.educationContext).toBe(
      'UNIVERSITY',
    );
    const after = (await create(agent, period.id, 'Filosofía')).body.subject;
    expect(after.educationContext).toBe('OTHER_ACADEMIC'); // the new default
    await useIs(agent, null);
    expect(
      (await create(agent, period.id, 'Estadística Aplicada')).body.subject.educationContext,
    ).toBeNull();
    const all = (await agent.get('/api/subjects')).body.subjects as {
      name: string;
      educationContext: string | null;
    }[];
    expect(Object.fromEntries(all.map((s) => [s.name, s.educationContext]))).toEqual({
      Anatomía: 'UNIVERSITY',
      Filosofía: 'OTHER_ACADEMIC',
      'Estadística Aplicada': null,
    });
  });

  it('a user without a profile is the existing invariant failure, and nothing is created or repaired', async () => {
    const { agent, period } = await withPeriod('u@example.com', 'UNIVERSITY_STUDENT');
    await prisma.userProfile.deleteMany();
    const res = await create(agent, period.id, 'Anatomía');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PROFILE_INVARIANT_BROKEN');
    expect(await prisma.subject.count()).toBe(0);
    expect(await prisma.userProfile.count()).toBe(0);
    // an explicit context does not need the profile's default, but the rule is still the same: the profile must exist
  });
});

describe('subjects created by Smart Capture and by the schedule import', () => {
  const capture = (agent: request.Agent, name: string) =>
    agent.post('/api/capture/confirm').send({
      items: [
        { clientId: 'c1', title: 'Parcial', dueDate: '2099-03-15', subject: { kind: 'NEW', name } },
      ],
    });
  const importClass = (agent: request.Agent, name: string) =>
    agent.post('/api/schedule-import/confirm').send({
      classes: [
        {
          clientId: 'a',
          weekday: 1,
          startTime: '08:00',
          endTime: '10:00',
          title: name,
          until: '2026-11-28',
          subject: { kind: 'NEW', name },
        },
      ],
    });

  it.each([
    ['UNIVERSITY_STUDENT', 'UNIVERSITY'],
    ['SCHOOL_STUDENT', 'SCHOOL'],
    ['OTHER_STUDENT', 'OTHER_ACADEMIC'],
  ])('Smart Capture with %s creates a %s subject', async (use, expected) => {
    const { agent } = await withPeriod(`${use}@example.com`, use);
    const res = await capture(agent, 'Diseño de Sistemas Distribuidos');
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(res.body.createdSubjects[0].educationContext).toBe(expected);
    expect((await prisma.subject.findFirstOrThrow()).educationContext).toBe(expected);
  });

  it('Smart Capture without a primary use creates a subject with no context', async () => {
    const { agent } = await withPeriod('old@example.com', null);
    const res = await capture(agent, 'Asignatura Experimental 847');
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects[0].educationContext).toBeNull();
  });

  it('Smart Capture never changes a subject that already exists', async () => {
    const { agent, period } = await withPeriod('u@example.com', 'UNIVERSITY_STUDENT');
    await create(agent, period.id, 'Taller de Escritura', { educationContext: 'OTHER_ACADEMIC' });
    const res = await capture(agent, 'taller de escritura');
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects).toEqual([]);
    expect((await prisma.subject.findFirstOrThrow()).educationContext).toBe('OTHER_ACADEMIC');
  });

  it.each([
    ['UNIVERSITY_STUDENT', 'UNIVERSITY'],
    ['SCHOOL_STUDENT', 'SCHOOL'],
  ])('the schedule import with %s creates a %s subject', async (use, expected) => {
    const { agent } = await withPeriod(`${use}@example.com`, use);
    const res = await importClass(agent, 'Estadística Aplicada');
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(res.body.createdSubjects[0].educationContext).toBe(expected);
  });

  it('the schedule import without a primary use creates a subject with no context', async () => {
    const { agent } = await withPeriod('old@example.com', null);
    const res = await importClass(agent, 'Filosofía');
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects[0].educationContext).toBeNull();
  });
});

describe('existing subjects (no context was ever stored for them)', () => {
  it('a subject written without the column answers null, and nothing turns it into a value', async () => {
    const { agent, user } = await setupUser(app, 'u@example.com').then((s) => ({
      agent: s.agent,
      user: s.user,
    }));
    await useIs(agent, 'UNIVERSITY_STUDENT');
    const period = await prisma.academicPeriod.findFirstOrThrow({ where: { userId: user.id } });
    const old = await prisma.subject.create({
      data: {
        userId: user.id,
        periodId: period.id,
        name: 'Antigua',
        nameKey: 'antigua',
        color: '#3B82F6',
      },
    });
    expect(old.educationContext).toBeNull();
    expect((await agent.get(`/api/subjects/${old.id}`)).body.subject.educationContext).toBeNull();
    await agent.patch(`/api/subjects/${old.id}`).send({ name: 'Antigua II' }).expect(200);
    expect(
      (await prisma.subject.findUniqueOrThrow({ where: { id: old.id } })).educationContext,
    ).toBeNull();
  });
});
