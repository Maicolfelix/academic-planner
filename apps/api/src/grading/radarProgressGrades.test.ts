import type { Express } from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

/**
 * Grade context in the Radar and the Progress. The Radar stays TEMPORAL (the weight is information, never order); the Progress
 * keeps activity progress and academic grade apart, and a subject with no scale or no cuts has `grade: null` (never a made-up 0.0).
 */
const NOW = new Date('2026-10-14T15:00:00.000Z');
const app: Express = buildApp({ clock: () => NOW });
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];
const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
const post = async (a: Agent, path: string, data: object) => {
  const res = await a.post(path).send(data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};

async function study(a: Agent, name: string, type: 'UNIVERSITY' | 'OTHER_ACADEMIC' = 'UNIVERSITY') {
  const st = (await post(a, '/api/study-tracks', { name, type })).studyTrack;
  const period = (
    await post(a, '/api/periods', { ...periodInput, name: `P ${name}`, studyTrackId: st.id })
  ).period;
  return { st, period };
}
async function subject(
  a: Agent,
  periodId: string,
  name: string,
  shares?: number[],
  withScale = true,
) {
  const s = (await post(a, '/api/subjects', { periodId, name })).subject;
  let cuts: { id: string; name: string }[] = [];
  if (shares) {
    cuts = (
      await post(a, `/api/subjects/${s.id}/grading/setup`, {
        ...(withScale && { profile: SCALE }),
        gradingPeriods: shares.map((finalShareBp, i) => ({ name: `Corte ${i + 1}`, finalShareBp })),
      })
    ).gradingPeriods;
  }
  return { ...s, cuts } as { id: string; name: string; cuts: { id: string; name: string }[] };
}
const activity = async (
  a: Agent,
  subjectId: string | null,
  title: string,
  dueDate = '2026-10-16',
) =>
  (
    await post(a, '/api/activities', {
      ...(subjectId && { subjectId }),
      title,
      dueDate,
      type: 'EXAM',
    })
  ).activity as { id: string };
const evaluation = async (a: Agent, body: object) =>
  (await post(a, '/api/evaluations', body)).evaluation;
const radar = async (a: Agent) => (await a.get('/api/radar').expect(200)).body.radar;
const progress = async (a: Agent) => (await a.get('/api/progress').expect(200)).body.progress;
const listed = (r: {
  groups: Record<string, { id: string; title: string; gradeContext?: unknown }[]>;
}) => Object.values(r.groups).flat();

describe('Radar: the grade context of a linked activity', () => {
  it('no evaluation (or no subject) → exactly as before: no gradeContext at all', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { period } = await study(agent, 'Medicina');
    const farma = await subject(agent, period.id, 'Farmacología', [3000, 3000, 4000]);
    await activity(agent, farma.id, 'Sin evaluación');
    await activity(agent, null, 'Sin asignatura');
    for (const a of listed(await radar(agent))) expect(a).not.toHaveProperty('gradeContext');
  });

  it('one evaluation: weight 30 % × 40 % = 12 % of the final grade, pending or with its score', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { period } = await study(agent, 'Medicina');
    const farma = await subject(agent, period.id, 'Farmacología', [3000, 3000, 4000]);
    const act = await activity(agent, farma.id, 'Parcial 1');
    const ev = await evaluation(agent, {
      subjectId: farma.id,
      gradingPeriodId: farma.cuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 4000,
      activityId: act.id,
    });
    let item = listed(await radar(agent)).find((a) => a.id === act.id)!;
    expect(item.gradeContext).toMatchObject({
      totalFinalWeightUnits: 12_000_000,
      evaluations: [
        {
          id: ev.id,
          name: 'Parcial',
          cutName: 'Corte 1',
          scoreMilli: null,
          periodShareBp: 4000,
          cutFinalShareBp: 3000,
          finalWeightUnits: 12_000_000,
        },
      ],
    });
    await agent.patch(`/api/evaluations/${ev.id}`).send({ scoreMilli: 4200 }).expect(200);
    item = listed(await radar(agent)).find((a) => a.id === act.id)!;
    expect(
      (item.gradeContext as { evaluations: { scoreMilli: number }[] }).evaluations[0]!.scoreMilli,
    ).toBe(4200);
  });

  it('several evaluations on one activity: all listed, none chosen, the weights add up', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { period } = await study(agent, 'Medicina');
    const farma = await subject(agent, period.id, 'Farmacología', [3000, 3000, 4000]);
    const act = await activity(agent, farma.id, 'Proyecto');
    await evaluation(agent, {
      subjectId: farma.id,
      gradingPeriodId: farma.cuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 4000,
      activityId: act.id,
    });
    await evaluation(agent, {
      subjectId: farma.id,
      gradingPeriodId: farma.cuts[1]!.id,
      name: 'Quiz',
      periodShareBp: 2000,
      activityId: act.id,
    });
    const item = listed(await radar(agent)).find((a) => a.id === act.id)!;
    const ctx = item.gradeContext as {
      evaluations: { name: string }[];
      totalFinalWeightUnits: number;
    };
    expect(ctx.evaluations.map((e) => e.name)).toEqual(['Parcial', 'Quiz']);
    expect(ctx.totalFinalWeightUnits).toBe(12_000_000 + 6_000_000);
  });

  it('the order never depends on the weight: identical deadlines keep the same order for 5 % and for 30 %', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { period } = await study(agent, 'Medicina');
    const farma = await subject(agent, period.id, 'Farmacología', [3000, 3000, 4000]);
    const first = await activity(agent, farma.id, 'A pesa poco');
    const second = await activity(agent, farma.id, 'B pesa mucho');
    const orderBefore = listed(await radar(agent)).map((a) => a.id);
    await evaluation(agent, {
      subjectId: farma.id,
      gradingPeriodId: farma.cuts[0]!.id,
      name: 'Taller',
      periodShareBp: 500,
      activityId: first.id,
    });
    await evaluation(agent, {
      subjectId: farma.id,
      gradingPeriodId: farma.cuts[2]!.id,
      name: 'Final',
      periodShareBp: 10_000,
      activityId: second.id,
    });
    const after = await radar(agent);
    expect(listed(after).map((a) => a.id)).toEqual(orderBefore);
    // and a heavier activity LATER in time stays later
    const late = await activity(agent, farma.id, 'C más tarde y pesa más', '2026-10-30');
    await evaluation(agent, {
      subjectId: farma.id,
      gradingPeriodId: farma.cuts[1]!.id,
      name: 'Otro final',
      periodShareBp: 10_000,
      activityId: late.id,
    });
    const all = listed(await radar(agent)).map((a) => a.id);
    expect(all.indexOf(late.id)).toBeGreaterThan(all.indexOf(second.id));
  });

  it('two studies: each activity carries its own subject’s cuts; another account never leaks in', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const med = await study(agent, 'Medicina');
    const dip = await study(agent, 'Diplomado', 'OTHER_ACADEMIC');
    const a = await subject(agent, med.period.id, 'Redes', [5000, 5000]);
    const b = await subject(agent, dip.period.id, 'Redes', [2500, 7500]);
    const actA = await activity(agent, a.id, 'Parcial A');
    const actB = await activity(agent, b.id, 'Parcial B');
    await evaluation(agent, {
      subjectId: a.id,
      gradingPeriodId: a.cuts[0]!.id,
      name: 'P',
      periodShareBp: 5000,
      activityId: actA.id,
    });
    await evaluation(agent, {
      subjectId: b.id,
      gradingPeriodId: b.cuts[0]!.id,
      name: 'P',
      periodShareBp: 5000,
      activityId: actB.id,
    });
    const items = listed(await radar(agent));
    const ctx = (id: string) =>
      (items.find((x) => x.id === id)!.gradeContext as { totalFinalWeightUnits: number })
        .totalFinalWeightUnits;
    expect(ctx(actA.id)).toBe(25_000_000); // 50 % × 50 %
    expect(ctx(actB.id)).toBe(12_500_000); // 25 % × 50 %

    const other = await signUp(app, 'b@example.com');
    const o = await study(other.agent, 'Ingeniería');
    const os = await subject(other.agent, o.period.id, 'Redes', [10_000]);
    const oa = await activity(other.agent, os.id, 'Ajeno');
    await evaluation(other.agent, {
      subjectId: os.id,
      gradingPeriodId: os.cuts[0]!.id,
      name: 'X',
      periodShareBp: 10_000,
      activityId: oa.id,
    });
    const mine = listed(await radar(agent)).map((x) => x.id);
    expect(mine).not.toContain(oa.id);
  });

  it('an archived study is not read (as before)', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    await study(agent, 'Medicina');
    const dip = await study(agent, 'Diplomado', 'OTHER_ACADEMIC');
    const b = await subject(agent, dip.period.id, 'Redes', [10_000]);
    const actB = await activity(agent, b.id, 'Parcial B');
    await evaluation(agent, {
      subjectId: b.id,
      gradingPeriodId: b.cuts[0]!.id,
      name: 'P',
      periodShareBp: 10_000,
      activityId: actB.id,
    });
    await agent.post(`/api/study-tracks/${dip.st.id}/archive`).send({});
    expect(listed(await radar(agent)).map((x) => x.id)).not.toContain(actB.id);
  });
});

describe('Progress: the academic grade of each subject, apart from the activities', () => {
  it('a subject with no scale or no cuts → grade null (never 0.0); the activities progress is untouched', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { period } = await study(agent, 'Medicina');
    await subject(agent, period.id, 'Sin notas');
    const configured = await subject(agent, period.id, 'Con notas', [3000, 3000, 4000]);
    const p = await progress(agent);
    const by = (name: string) => p.subjects.find((s: { name: string }) => s.name === name);
    expect(by('Sin notas').grade).toBeNull();
    expect(by('Con notas').grade).toMatchObject({
      accumulatedMilli: null,
      cutsWithGrade: 0,
      cutsTotal: 3,
      maxMilli: 5000,
    });
    expect(by('Sin notas')).toHaveProperty('total'); // the activity fields are still there
    void configured;
  });

  it('partial: Corte 1 = 4.0 → accumulated 1.2, average 4.0, 1 of 3 cuts; complete: 3.9 and 3 of 3', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const { period } = await study(agent, 'Medicina');
    const cyber = await subject(agent, period.id, 'Ciberseguridad', [3000, 3000, 4000]);
    await agent
      .post('/api/evaluations')
      .send({
        subjectId: cyber.id,
        gradingPeriodId: cyber.cuts[0]!.id,
        isCutGrade: true,
        scoreMilli: 4000,
      })
      .expect(201);
    let g = (await progress(agent)).subjects[0].grade;
    expect(g).toMatchObject({
      accumulatedMilli: 1200,
      currentMilli: 4000,
      cutsWithGrade: 1,
      cutsTotal: 3,
      evaluatedWeightUnits: 30_000_000,
      remainingWeightUnits: 70_000_000,
      complete: true,
    });
    await agent
      .post('/api/evaluations')
      .send({
        subjectId: cyber.id,
        gradingPeriodId: cyber.cuts[1]!.id,
        isCutGrade: true,
        scoreMilli: 4500,
      })
      .expect(201);
    await agent
      .post('/api/evaluations')
      .send({
        subjectId: cyber.id,
        gradingPeriodId: cyber.cuts[2]!.id,
        isCutGrade: true,
        scoreMilli: 3200,
      })
      .expect(201);
    g = (await progress(agent)).subjects[0].grade;
    expect(g).toMatchObject({ accumulatedMilli: 3830, cutsWithGrade: 3, remainingWeightUnits: 0 });
  });

  it('each subject uses its own distribution, and the same name in two studies is never mixed', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const med = await study(agent, 'Medicina');
    const dip = await study(agent, 'Diplomado', 'OTHER_ACADEMIC');
    const a = await subject(agent, med.period.id, 'Redes', [3000, 3000, 4000]);
    const b = await subject(agent, dip.period.id, 'Redes', [10_000]);
    await agent
      .post('/api/evaluations')
      .send({ subjectId: a.id, gradingPeriodId: a.cuts[0]!.id, isCutGrade: true, scoreMilli: 4000 })
      .expect(201);
    await agent
      .post('/api/evaluations')
      .send({ subjectId: b.id, gradingPeriodId: b.cuts[0]!.id, isCutGrade: true, scoreMilli: 4000 })
      .expect(201);
    const p = await progress(agent);
    const ra = p.subjects.find((s: { id: string }) => s.id === a.id);
    const rb = p.subjects.find((s: { id: string }) => s.id === b.id);
    expect(ra.periodId).not.toBe(rb.periodId);
    expect(ra.grade.accumulatedMilli).toBe(1200);
    expect(rb.grade.accumulatedMilli).toBe(4000);
    expect(rb.grade.cutsTotal).toBe(1);
  });

  it('an archived study is excluded; another account’s grades never appear', async () => {
    const { agent } = await signUp(app, 'a@example.com');
    const med = await study(agent, 'Medicina');
    const dip = await study(agent, 'Diplomado', 'OTHER_ACADEMIC');
    await subject(agent, med.period.id, 'Redes', [10_000]);
    await subject(agent, dip.period.id, 'Inglés', [10_000]);
    await agent.post(`/api/study-tracks/${dip.st.id}/archive`).send({});
    const names = (await progress(agent)).subjects.map((s: { name: string }) => s.name);
    expect(names).toEqual(['Redes']);
    const other = await signUp(app, 'b@example.com');
    const o = await study(other.agent, 'Ingeniería');
    await subject(other.agent, o.period.id, 'Ajena', [10_000]);
    expect((await progress(agent)).subjects.map((s: { name: string }) => s.name)).not.toContain(
      'Ajena',
    );
  });

  it('anonymous: 401', async () => {
    const res = await (await import('supertest')).default(app).get('/api/progress');
    expect(res.status).toBe(401);
  });
});
