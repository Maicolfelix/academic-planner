import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SUBJECT_COLOR_VALUES } from '@planner/core';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Subj = {
  id: string;
  name: string;
  color: string;
  educationContext: string | null;
  periodId: string;
};
const batch = (agent: request.Agent, body: unknown) =>
  agent.post('/api/subjects/batch').send(body as object);
const withPeriod = async (email: string, primaryUse: string | null = null) => {
  const s = await signUp(app, email);
  const period = (await s.agent.post('/api/periods').send(periodInput)).body.period;
  if (primaryUse) await s.agent.patch('/api/profile').send({ primaryUse }).expect(200);
  return { ...s, period };
};
const names = (subjects: Subj[]) => subjects.map((s) => s.name);

describe('POST /api/subjects/batch: creating', () => {
  it('creates one subject in the current period', async () => {
    const { agent, period } = await withPeriod('a@example.com');
    const res = await batch(agent, { names: ['Anatomía'] });
    expect(res.status).toBe(201);
    expect(names(res.body.subjects)).toEqual(['Anatomía']);
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(res.body.reusedSubjects).toEqual([]);
    expect(res.body.subjects[0].periodId).toBe(period.id);
  });

  it('creates many, in the order written (not alphabetical), each with its own distinct color', async () => {
    const { agent } = await withPeriod('a@example.com');
    const input = ['Zoología', 'Anatomía', 'Bioética', 'Farmacología', 'Semiología'];
    const res = await batch(agent, { names: input });
    expect(res.status).toBe(201);
    expect(names(res.body.subjects)).toEqual(input);
    expect(names(res.body.createdSubjects)).toEqual(input);
    const colors = res.body.subjects.map((s: Subj) => s.color);
    expect(new Set(colors).size).toBe(5);
    expect(colors).toEqual(SUBJECT_COLOR_VALUES.slice(0, 5)); // the first free color goes to the first name written
    expect(await prisma.subject.count()).toBe(5);
  });

  it('names that normalize to the same key are ONE subject (first spelling, first position)', async () => {
    const { agent } = await withPeriod('a@example.com');
    const res = await batch(agent, {
      names: ['Farmacología', 'Semiología', 'farmacologia', ' FARMACOLOGÍA '],
    });
    expect(res.status).toBe(201);
    expect(names(res.body.subjects)).toEqual(['Farmacología', 'Semiología']);
    expect(await prisma.subject.count()).toBe(2);
  });

  it('works for any names, not only the ones of a program', async () => {
    const { agent } = await withPeriod('a@example.com');
    const input = [
      'Asignatura Experimental 847',
      'Diseño de Sistemas Distribuidos',
      'Taller de Escritura',
      'Estadística Aplicada',
      'Filosofía',
    ];
    const res = await batch(agent, { names: input });
    expect(names(res.body.subjects)).toEqual(input);
  });
});

describe('POST /api/subjects/batch: subjects that already exist', () => {
  it('reuses them as they are (color and context untouched), without error', async () => {
    const { agent, period } = await withPeriod('a@example.com', 'UNIVERSITY_STUDENT');
    const made = (
      await agent.post('/api/subjects').send({
        periodId: period.id,
        name: 'Anatomía',
        color: '#EF4444',
        educationContext: 'OTHER_ACADEMIC',
      })
    ).body.subject;
    const res = await batch(agent, { names: ['anatomia'] });
    expect(res.status).toBe(201);
    expect(res.body.createdSubjects).toEqual([]);
    expect(res.body.reusedSubjects).toEqual([{ id: made.id, name: 'Anatomía' }]);
    expect(res.body.subjects[0]).toMatchObject({
      id: made.id,
      color: '#EF4444',
      educationContext: 'OTHER_ACADEMIC',
    });
    expect(await prisma.subject.count()).toBe(1);
  });

  it('a mix: the answer keeps the input order, with reused and created in their places; colors skip the used ones', async () => {
    const { agent, period } = await withPeriod('a@example.com');
    const old = (
      await agent
        .post('/api/subjects')
        .send({ periodId: period.id, name: 'Bioética', color: '#3B82F6' })
    ).body.subject;
    const res = await batch(agent, { names: ['Anatomía', 'Bioética', 'Cirugía'] });
    expect(names(res.body.subjects)).toEqual(['Anatomía', 'Bioética', 'Cirugía']);
    expect(names(res.body.createdSubjects)).toEqual(['Anatomía', 'Cirugía']);
    expect(res.body.reusedSubjects).toEqual([{ id: old.id, name: 'Bioética' }]);
    // #3B82F6 is taken by Bioética: the new ones take the next free colors, in order
    expect(res.body.subjects.map((s: Subj) => s.color)).toEqual(['#EF4444', '#3B82F6', '#10B981']);
  });

  it('repeating the same batch creates nothing new and answers the same order (a retry is harmless)', async () => {
    const { agent } = await withPeriod('a@example.com');
    const input = ['Anatomía', 'Bioética', 'Farmacología'];
    const first = await batch(agent, { names: input });
    const again = await batch(agent, { names: input });
    expect(again.status).toBe(201);
    expect(again.body.createdSubjects).toEqual([]);
    expect(names(again.body.subjects)).toEqual(input);
    expect(again.body.subjects.map((s: Subj) => s.id)).toEqual(
      first.body.subjects.map((s: Subj) => s.id),
    );
    expect(await prisma.subject.count()).toBe(3);
  });
});

describe('POST /api/subjects/batch: colors', () => {
  it('past the palette they start over, one after another (never one color for all)', async () => {
    const { agent } = await withPeriod('a@example.com');
    const input = Array.from({ length: 13 }, (_, i) => `Materia ${String.fromCharCode(65 + i)}`);
    const res = await batch(agent, { names: input });
    const colors = res.body.subjects.map((s: Subj) => s.color);
    expect(colors.slice(0, 10)).toEqual([...SUBJECT_COLOR_VALUES]);
    expect(colors.slice(10)).toEqual([
      SUBJECT_COLOR_VALUES[0],
      SUBJECT_COLOR_VALUES[1],
      SUBJECT_COLOR_VALUES[2],
    ]);
    expect(new Set(colors.slice(0, 10)).size).toBe(10);
  });
});

describe('POST /api/subjects/batch: education context', () => {
  it.each([
    ['UNIVERSITY_STUDENT', 'UNIVERSITY'],
    ['SCHOOL_STUDENT', 'SCHOOL'],
    ['OTHER_STUDENT', 'OTHER_ACADEMIC'],
    ['TEACHER', 'OTHER_ACADEMIC'],
    ['PERSONAL', 'OTHER_ACADEMIC'],
  ])('the whole batch takes the default of %s: %s', async (use, expected) => {
    const { agent } = await withPeriod(`${use}@example.com`, use);
    const res = await batch(agent, {
      names: [
        'Anatomía',
        'Filosofía',
        'Estadística Aplicada',
        'Taller de Escritura',
        'Diseño de Sistemas Distribuidos',
      ],
    });
    expect(res.body.subjects.map((s: Subj) => s.educationContext)).toEqual(Array(5).fill(expected));
  });

  it('without a primary use there is no context', async () => {
    const { agent } = await withPeriod('old@example.com');
    const res = await batch(agent, { names: ['Anatomía', 'Bioética'] });
    expect(res.body.subjects.map((s: Subj) => s.educationContext)).toEqual([null, null]);
  });

  it('one optional context for the whole batch overrides the default (and null means not specified)', async () => {
    const { agent } = await withPeriod('a@example.com', 'UNIVERSITY_STUDENT');
    const external = await batch(agent, {
      names: ['Inglés B2', 'Francés A1'],
      educationContext: 'OTHER_ACADEMIC',
    });
    expect(external.body.subjects.map((s: Subj) => s.educationContext)).toEqual([
      'OTHER_ACADEMIC',
      'OTHER_ACADEMIC',
    ]);
    const none = await batch(agent, { names: ['Alemán'], educationContext: null });
    expect(none.body.subjects[0].educationContext).toBeNull();
  });

  it('never rewrites the context of a subject that is only reused', async () => {
    const { agent } = await withPeriod('a@example.com', 'UNIVERSITY_STUDENT');
    await batch(agent, { names: ['Anatomía'] });
    const res = await batch(agent, {
      names: ['Anatomía', 'Inglés'],
      educationContext: 'OTHER_ACADEMIC',
    });
    expect(res.body.subjects.map((s: Subj) => [s.name, s.educationContext])).toEqual([
      ['Anatomía', 'UNIVERSITY'],
      ['Inglés', 'OTHER_ACADEMIC'],
    ]);
  });

  it('a user without a profile is the invariant failure: 500, nothing created, nothing repaired', async () => {
    const { agent } = await withPeriod('a@example.com', 'UNIVERSITY_STUDENT');
    await prisma.userProfile.deleteMany();
    const res = await batch(agent, { names: ['Anatomía'] });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PROFILE_INVARIANT_BROKEN');
    expect(await prisma.subject.count()).toBe(0);
    expect(await prisma.userProfile.count()).toBe(0);
  });
});

describe('POST /api/subjects/batch: the period is always the current one', () => {
  it('uses the current period, not another one of the user', async () => {
    const { agent, period } = await withPeriod('a@example.com');
    const second = (
      await agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Otro', startDate: '2027-02-01', endDate: '2027-06-01' })
    ).body.period;
    expect(second.isCurrent).toBe(false);
    const res = await batch(agent, { names: ['Anatomía'] });
    expect(res.body.subjects[0].periodId).toBe(period.id);
    await agent.patch(`/api/periods/${second.id}`).send({ isCurrent: true }).expect(200);
    const later = await batch(agent, { names: ['Bioética'] });
    expect(later.body.subjects[0].periodId).toBe(second.id);
  });

  it('without a current period it answers 400 NO_CURRENT_PERIOD and creates nothing', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const res = await batch(agent, { names: ['Anatomía'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CURRENT_PERIOD');
    expect(await prisma.subject.count()).toBe(0);
  });

  it('never touches another user’s period or subjects, even with the same names', async () => {
    const a = await withPeriod('a@example.com');
    const b = await withPeriod('b@example.com');
    await batch(a.agent, { names: ['Anatomía'] });
    const res = await batch(b.agent, { names: ['Anatomía'] });
    expect(res.body.createdSubjects).toHaveLength(1);
    expect(res.body.subjects[0].periodId).toBe(b.period.id);
    expect(await prisma.subject.count({ where: { periodId: a.period.id } })).toBe(1);
    expect(await prisma.subject.count({ where: { periodId: b.period.id } })).toBe(1);
  });
});

describe('POST /api/subjects/batch: input and security', () => {
  it('needs a session', async () => {
    expect(
      (
        await request(app)
          .post('/api/subjects/batch')
          .send({ names: ['A'] })
      ).status,
    ).toBe(401);
  });

  it('refuses another origin (CSRF) and creates nothing', async () => {
    const { agent } = await withPeriod('a@example.com');
    const res = await agent
      .post('/api/subjects/batch')
      .set('Origin', 'https://evil.example')
      .send({ names: ['A'] });
    expect(res.status).toBe(403);
    expect(await prisma.subject.count()).toBe(0);
  });

  it('is strict: no owner, period, colors, primary use or any other field', async () => {
    const { agent, period, user } = await withPeriod('a@example.com');
    for (const extra of [
      { userId: user.id },
      { periodId: period.id },
      { color: '#EF4444' },
      { colors: ['#EF4444'] },
      { primaryUse: 'SCHOOL_STUDENT' },
      { owner: user.id },
      { gradingEnabled: true },
    ]) {
      const res = await batch(agent, { names: ['Anatomía'], ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await prisma.subject.count()).toBe(0);
  });

  it('refuses no names, more than 30, bad names and a bad context', async () => {
    const { agent } = await withPeriod('a@example.com');
    const bad: unknown[] = [
      {},
      { names: [] },
      { names: 'Anatomía' },
      { names: Array.from({ length: 31 }, (_, i) => `M${i}`) },
      { names: [''] },
      { names: ['   '] },
      { names: ['x'.repeat(101)] },
      { names: ['Ana\u0000tomía'] },
      { names: [7] },
      { names: ['Bien', null] },
      { names: ['A'], educationContext: 'PERSONAL' },
      { names: ['A'], educationContext: 'university' },
      [],
    ];
    for (const body of bad) {
      const res = await batch(agent, body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(await prisma.subject.count()).toBe(0);
    expect(
      (await batch(agent, { names: Array.from({ length: 30 }, (_, i) => `M${i}`) })).status,
    ).toBe(201);
  });

  it('is private: no-store on success and on error', async () => {
    const { agent } = await withPeriod('a@example.com');
    expect((await batch(agent, { names: ['A'] })).headers['cache-control']).toBe('no-store');
    expect((await batch(agent, { names: [] })).headers['cache-control']).toBe('no-store');
    expect((await request(app).post('/api/subjects/batch').send({})).headers['cache-control']).toBe(
      'no-store',
    );
  });

  it('a malformed id still means 404 on the id routes (the batch route did not shadow them)', async () => {
    const { agent } = await withPeriod('a@example.com');
    expect((await agent.get(`/api/subjects/${randomUUID()}`)).status).toBe(404);
    expect((await agent.get('/api/subjects/batch')).status).toBe(404);
  });
});

describe('POST /api/subjects/batch: one transaction, and simultaneous requests', () => {
  it('a failure in the middle creates NOTHING of the batch', async () => {
    const { agent } = await withPeriod('a@example.com');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION subject_batch_test_fail() RETURNS trigger AS $$
      BEGIN IF NEW."nameKey" = 'falla' THEN RAISE EXCEPTION 'fails on purpose'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER subject_batch_test_fail BEFORE INSERT ON "Subject"
        FOR EACH ROW EXECUTE FUNCTION subject_batch_test_fail();
    `);
    try {
      const res = await batch(agent, { names: ['Anatomía', 'Bioética', 'Falla', 'Cirugía'] });
      expect(res.status).toBe(500);
      expect(await prisma.subject.count()).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS subject_batch_test_fail ON "Subject"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS subject_batch_test_fail()`);
    }
    expect((await batch(agent, { names: ['Anatomía', 'Bioética', 'Falla'] })).status).toBe(201);
    expect(await prisma.subject.count()).toBe(3);
  });

  it('simultaneous requests with the same names (in different orders) create each subject once', async () => {
    const { agent } = await withPeriod('a@example.com');
    const forward = ['Anatomía', 'Bioética', 'Cirugía', 'Dermatología', 'Endocrinología'];
    const backward = [...forward].reverse();
    const results = await Promise.all([
      batch(agent, { names: forward }),
      batch(agent, { names: backward }),
      batch(agent, { names: forward }),
      batch(agent, { names: backward }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(await prisma.subject.count()).toBe(5);
    // every request answers in ITS input order, with the same five rows
    expect(names(results[0]!.body.subjects)).toEqual(forward);
    expect(names(results[1]!.body.subjects)).toEqual(backward);
    const ids = (r: { body: { subjects: Subj[] } }) => new Set(r.body.subjects.map((s) => s.id));
    expect(ids(results[0]!)).toEqual(ids(results[1]!));
    // the created ones add up to exactly five across all requests
    expect(results.reduce((n, r) => n + r.body.createdSubjects.length, 0)).toBe(5);
    // and no two share a color
    const colors = (await prisma.subject.findMany()).map((s) => s.color);
    expect(new Set(colors).size).toBe(5);
  });

  it('a batch racing a manual create of the same name reuses it instead of failing', async () => {
    const { agent, period } = await withPeriod('a@example.com');
    const [a, b] = await Promise.all([
      batch(agent, { names: ['Anatomía', 'Bioética'] }),
      agent.post('/api/subjects').send({ periodId: period.id, name: 'Bioética' }),
    ]);
    expect(a.status).toBe(201);
    expect([201, 409]).toContain(b.status); // the manual one may lose to the unique index, with its usual 409
    expect(await prisma.subject.count()).toBe(2);
  });
});
