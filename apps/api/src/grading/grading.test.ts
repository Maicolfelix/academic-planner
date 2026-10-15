import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type Agent = request.Agent;
const SCALE_05 = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };

/** A user with a study, a period of that study, a subject, and (optionally) the 0–5 scale with 30/30/40 cuts. */
async function world(
  email = 'ana@example.com',
  opts: { grading?: boolean; tracked?: boolean } = {},
) {
  const { agent, user } = await signUp(app, email);
  const track = (
    await agent.post('/api/study-tracks').send({ name: 'Medicina', type: 'UNIVERSITY' }).expect(201)
  ).body.studyTrack;
  const period = (
    await agent
      .post('/api/periods')
      .send({ ...periodInput, ...(opts.tracked === false ? {} : { studyTrackId: track.id }) })
      .expect(201)
  ).body.period;
  const subject = (
    await agent
      .post('/api/subjects')
      .send({ periodId: period.id, name: 'Farmacología' })
      .expect(201)
  ).body.subject;
  const cuts: { id: string }[] = [];
  if (opts.grading !== false && opts.tracked !== false) {
    await agent.post(`/api/periods/${period.id}/grading`).send(SCALE_05).expect(201);
    for (const [name, finalShareBp] of [
      ['Corte 1', 3000],
      ['Corte 2', 3000],
      ['Corte 3', 4000],
    ] as const) {
      cuts.push(
        (
          await agent
            .post(`/api/periods/${period.id}/grading-periods`)
            .send({ name, finalShareBp })
            .expect(201)
        ).body.gradingPeriod,
      );
    }
  }
  return { agent, user, track, period, subject, cuts };
}

const evaluation = (a: Agent, body: object) => a.post('/api/evaluations').send(body);

describe('grading setup', () => {
  it('configures the scale, lists it and refuses a second profile', async () => {
    const w = await world('a@example.com', { grading: false });
    expect((await w.agent.get(`/api/periods/${w.period.id}/grading`).expect(200)).body).toEqual({
      profile: null,
      gradingPeriods: [],
    });
    const created = await w.agent
      .post(`/api/periods/${w.period.id}/grading`)
      .send(SCALE_05)
      .expect(201);
    expect(created.body.profile).toMatchObject({ ...SCALE_05, periodId: w.period.id });
    expect(created.body.profile).not.toHaveProperty('userId');
    const again = await w.agent.post(`/api/periods/${w.period.id}/grading`).send(SCALE_05);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('GRADING_EXISTS');
    const got = await w.agent.get(`/api/periods/${w.period.id}/grading`).expect(200);
    expect(got.body.profile.passMilli).toBe(3000);
  });

  it('refuses a period that belongs to no study', async () => {
    const w = await world('a@example.com', { tracked: false });
    const res = await w.agent.post(`/api/periods/${w.period.id}/grading`).send(SCALE_05);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_NOT_TRACKED');
    expect(await prisma.gradingProfile.count()).toBe(0);
  });

  it.each([
    ['min >= max', { ...SCALE_05, minMilli: 5000 }],
    ['pass below min', { minMilli: 1000, maxMilli: 7000, passMilli: 500, decimals: 1 }],
    ['pass above max', { ...SCALE_05, passMilli: 5001 }],
    ['decimals out of range', { ...SCALE_05, decimals: 4 }],
    ['unbounded scale', { ...SCALE_05, maxMilli: 100_001 }],
    ['negative min', { ...SCALE_05, minMilli: -1 }],
    ['fractional', { ...SCALE_05, passMilli: 3000.5 }],
    ['unknown field', { ...SCALE_05, userId: randomUUID() }],
    ['empty', {}],
  ])('rejects an invalid scale: %s', async (_label, body) => {
    const w = await world('a@example.com', { grading: false });
    const res = await w.agent.post(`/api/periods/${w.period.id}/grading`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('updates the pass mark and decimals; re-checks the merged scale', async () => {
    const w = await world();
    const ok = await w.agent.patch(`/api/periods/${w.period.id}/grading`).send({ passMilli: 3500 });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.passMilli).toBe(3500);
    const bad = await w.agent.patch(`/api/periods/${w.period.id}/grading`).send({ maxMilli: 3000 });
    expect(bad.status).toBe(400); // max 3000 <= min? no: pass 3500 above max 3000
    expect(
      (await w.agent.patch(`/api/periods/${w.period.id}/grading`).send({}).expect(400)).status,
    ).toBe(400);
  });

  it('min/max become immutable once a score exists; pass and decimals stay editable', async () => {
    const w = await world();
    await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 10_000,
      scoreMilli: 4000,
    }).expect(201);
    const locked = await w.agent
      .patch(`/api/periods/${w.period.id}/grading`)
      .send({ maxMilli: 6000 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('GRADING_SCALE_LOCKED');
    await w.agent
      .patch(`/api/periods/${w.period.id}/grading`)
      .send({ passMilli: 2500, decimals: 2 })
      .expect(200);
    // The same min/max in the body is not a change.
    await w.agent.patch(`/api/periods/${w.period.id}/grading`).send({ maxMilli: 5000 }).expect(200);
  });

  it('min/max stay editable while nothing is scored', async () => {
    const w = await world();
    await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 10_000,
    }).expect(201);
    await w.agent
      .patch(`/api/periods/${w.period.id}/grading`)
      .send({ maxMilli: 10_000, passMilli: 6000 })
      .expect(200);
  });
});

describe('cuts', () => {
  it('require the scale first', async () => {
    const w = await world('a@example.com', { grading: false });
    const res = await w.agent
      .post(`/api/periods/${w.period.id}/grading-periods`)
      .send({ name: 'Corte 1', finalShareBp: 3000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADING_NOT_CONFIGURED');
  });

  it('are numbered by the server and listed in order', async () => {
    const w = await world();
    expect(w.cuts).toHaveLength(3);
    const list = (await w.agent.get(`/api/periods/${w.period.id}/grading`).expect(200)).body;
    expect(list.gradingPeriods.map((c: { position: number }) => c.position)).toEqual([1, 2, 3]);
  });

  it('cannot add up to more than 100 %', async () => {
    const w = await world(); // already 100 %
    const res = await w.agent
      .post(`/api/periods/${w.period.id}/grading-periods`)
      .send({ name: 'Extra', finalShareBp: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.finalShareBp).toBeDefined();
    const grow = await w.agent
      .patch(`/api/grading-periods/${w.cuts[0]!.id}`)
      .send({ finalShareBp: 3001 });
    expect(grow.status).toBe(400);
    await w.agent
      .patch(`/api/grading-periods/${w.cuts[0]!.id}`)
      .send({ finalShareBp: 2000, name: 'Primero' })
      .expect(200);
    expect(await prisma.gradingPeriod.count()).toBe(3);
  });

  it('under 100 % is allowed (incomplete is an estimate, not an error)', async () => {
    const w = await world('a@example.com', { grading: false });
    await w.agent.post(`/api/periods/${w.period.id}/grading`).send(SCALE_05).expect(201);
    await w.agent
      .post(`/api/periods/${w.period.id}/grading-periods`)
      .send({ name: 'Corte 1', finalShareBp: 3000 })
      .expect(201);
  });

  it.each([[0], [10_001], [-5], [12.5]])('rejects the weight %s', async (finalShareBp) => {
    const w = await world('a@example.com', { grading: false });
    await w.agent.post(`/api/periods/${w.period.id}/grading`).send(SCALE_05).expect(201);
    await w.agent
      .post(`/api/periods/${w.period.id}/grading-periods`)
      .send({ name: 'C', finalShareBp })
      .expect(400);
  });

  it('concurrent creations cannot pass 100 %', async () => {
    const w = await world('a@example.com', { grading: false });
    await w.agent.post(`/api/periods/${w.period.id}/grading`).send(SCALE_05).expect(201);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        w.agent
          .post(`/api/periods/${w.period.id}/grading-periods`)
          .send({ name: `C${i}`, finalShareBp: 2500 }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    const sum = await prisma.gradingPeriod.aggregate({ _sum: { finalShareBp: true } });
    expect(sum._sum.finalShareBp).toBe(10_000);
    const positions = (await prisma.gradingPeriod.findMany()).map((c) => c.position).sort();
    expect(positions).toEqual([1, 2, 3, 4]);
  });

  it('a cut with evaluations is not deleted (409); an empty one is', async () => {
    const w = await world();
    await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'P',
      periodShareBp: 5000,
    }).expect(201);
    const res = await w.agent.delete(`/api/grading-periods/${w.cuts[0]!.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADING_PERIOD_NOT_EMPTY');
    await w.agent.delete(`/api/grading-periods/${w.cuts[1]!.id}`).expect(204);
    expect(await prisma.gradingPeriod.count()).toBe(2);
  });
});

describe('evaluations', () => {
  const base = (w: Awaited<ReturnType<typeof world>>, extra: object = {}) => ({
    subjectId: w.subject.id,
    gradingPeriodId: w.cuts[0]!.id,
    name: 'Parcial',
    periodShareBp: 5000,
    ...extra,
  });

  it('needs the scale; the cut and subject must share the period', async () => {
    const none = await world('a@example.com', { grading: false });
    const res = await evaluation(none.agent, {
      subjectId: none.subject.id,
      gradingPeriodId: randomUUID(),
      name: 'P',
      periodShareBp: 1000,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADING_NOT_CONFIGURED');

    // A second period with its own cut: the cut of another period is refused.
    const w = await world('b@example.com');
    const p2 = (
      await w.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Otro', studyTrackId: w.track.id })
        .expect(201)
    ).body.period;
    await w.agent.post(`/api/periods/${p2.id}/grading`).send(SCALE_05).expect(201);
    const cut2 = (
      await w.agent
        .post(`/api/periods/${p2.id}/grading-periods`)
        .send({ name: 'C', finalShareBp: 10_000 })
        .expect(201)
    ).body.gradingPeriod;
    const cross = await evaluation(w.agent, base(w, { gradingPeriodId: cut2.id }));
    expect(cross.status).toBe(400);
    expect(cross.body.error.details.fields.gradingPeriodId).toBeDefined();
  });

  it('creates with the owner and period derived by the server', async () => {
    const w = await world();
    const res = await evaluation(w.agent, base(w, { scoreMilli: 4200 })).expect(201);
    expect(res.body.evaluation).toMatchObject({
      periodId: w.period.id,
      subjectId: w.subject.id,
      scoreMilli: 4200,
      activityId: null,
    });
    expect(res.body.evaluation.scoredAt).toEqual(expect.any(String));
    expect(res.body.evaluation).not.toHaveProperty('userId');
    const row = await prisma.evaluation.findFirstOrThrow();
    expect(row.userId).toBe(w.user.id);
  });

  it('never accepts the owner or the period from the client', async () => {
    const w = await world();
    for (const extra of [{ userId: randomUUID() }, { periodId: w.period.id }]) {
      await evaluation(w.agent, base(w, extra)).expect(400);
    }
  });

  it('evaluation weights inside a cut cannot pass 100 % (per subject)', async () => {
    const w = await world();
    await evaluation(w.agent, base(w, { periodShareBp: 6000 })).expect(201);
    const over = await evaluation(w.agent, base(w, { name: 'Otro', periodShareBp: 4001 }));
    expect(over.status).toBe(400);
    expect(over.body.error.details.fields.periodShareBp).toBeDefined();
    await evaluation(w.agent, base(w, { name: 'Otro', periodShareBp: 4000 })).expect(201);
    // Another cut, and another subject, have their own 100 %.
    await evaluation(
      w.agent,
      base(w, { gradingPeriodId: w.cuts[1]!.id, periodShareBp: 10_000 }),
    ).expect(201);
    const other = (
      await w.agent.post('/api/subjects').send({ periodId: w.period.id, name: 'Redes' }).expect(201)
    ).body.subject;
    await evaluation(w.agent, base(w, { subjectId: other.id, periodShareBp: 10_000 })).expect(201);
  });

  it('concurrent evaluations cannot pass 100 %', async () => {
    const w = await world();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        evaluation(w.agent, base(w, { name: `E${i}`, periodShareBp: 2500 })),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    const sum = await prisma.evaluation.aggregate({ _sum: { periodShareBp: true } });
    expect(sum._sum.periodShareBp).toBe(10_000);
  });

  it('moving an evaluation to another cut re-checks that cut', async () => {
    const w = await world();
    await evaluation(
      w.agent,
      base(w, { gradingPeriodId: w.cuts[1]!.id, periodShareBp: 9000 }),
    ).expect(201);
    const mine = (await evaluation(w.agent, base(w, { periodShareBp: 5000 })).expect(201)).body
      .evaluation;
    await w.agent
      .patch(`/api/evaluations/${mine.id}`)
      .send({ gradingPeriodId: w.cuts[1]!.id })
      .expect(400);
    await w.agent
      .patch(`/api/evaluations/${mine.id}`)
      .send({ gradingPeriodId: w.cuts[1]!.id, periodShareBp: 1000 })
      .expect(200);
  });

  it('scores must be inside the scale', async () => {
    const w = await world();
    expect((await evaluation(w.agent, base(w, { scoreMilli: 5001 }))).status).toBe(400);
    expect((await evaluation(w.agent, base(w, { scoreMilli: -1 }))).status).toBe(400);
    const ok = (await evaluation(w.agent, base(w, { scoreMilli: 5000 })).expect(201)).body
      .evaluation;
    await w.agent.patch(`/api/evaluations/${ok.id}`).send({ scoreMilli: 5001 }).expect(400);
    // A scale that starts above 0 refuses what is below its minimum.
    const w2 = await world('b@example.com', { grading: false });
    await w2.agent
      .post(`/api/periods/${w2.period.id}/grading`)
      .send({ minMilli: 1000, maxMilli: 7000, passMilli: 4000, decimals: 1 })
      .expect(201);
    const cut = (
      await w2.agent
        .post(`/api/periods/${w2.period.id}/grading-periods`)
        .send({ name: 'N', finalShareBp: 10_000 })
        .expect(201)
    ).body.gradingPeriod;
    await evaluation(w2.agent, {
      subjectId: w2.subject.id,
      gradingPeriodId: cut.id,
      name: 'P',
      periodShareBp: 5000,
      scoreMilli: 900,
    }).expect(400);
  });

  it('keeps "18 of 20" apart and converts only on a scale that starts at 0', async () => {
    const w = await world();
    const conv = (
      await evaluation(w.agent, base(w, { rawEarnedMilli: 18_000, rawMaxMilli: 20_000 })).expect(
        201,
      )
    ).body.evaluation;
    expect(conv).toMatchObject({ scoreMilli: 4500, rawEarnedMilli: 18_000, rawMaxMilli: 20_000 });
    // An explicit score is the canonical one; the raw pair is kept as reported.
    const both = (
      await evaluation(
        w.agent,
        base(w, {
          name: 'B',
          periodShareBp: 1000,
          scoreMilli: 4400,
          rawEarnedMilli: 18_000,
          rawMaxMilli: 20_000,
        }),
      ).expect(201)
    ).body.evaluation;
    expect(both.scoreMilli).toBe(4400);
    // 1–7 scale: no automatic conversion.
    const w2 = await world('b@example.com', { grading: false });
    await w2.agent
      .post(`/api/periods/${w2.period.id}/grading`)
      .send({ minMilli: 1000, maxMilli: 7000, passMilli: 4000, decimals: 1 })
      .expect(201);
    const cut = (
      await w2.agent
        .post(`/api/periods/${w2.period.id}/grading-periods`)
        .send({ name: 'N', finalShareBp: 10_000 })
        .expect(201)
    ).body.gradingPeriod;
    const body = {
      subjectId: w2.subject.id,
      gradingPeriodId: cut.id,
      name: 'P',
      periodShareBp: 5000,
      rawEarnedMilli: 18_000,
      rawMaxMilli: 20_000,
    };
    expect((await evaluation(w2.agent, body)).status).toBe(400);
    await evaluation(w2.agent, { ...body, scoreMilli: 6500 }).expect(201);
  });

  it.each([
    ['only earned', { scoreMilli: 3000, rawEarnedMilli: 10_000 }],
    ['only max', { scoreMilli: 3000, rawMaxMilli: 10_000 }],
    ['earned > max', { scoreMilli: 3000, rawEarnedMilli: 11_000, rawMaxMilli: 10_000 }],
    ['max = 0', { scoreMilli: 3000, rawEarnedMilli: 0, rawMaxMilli: 0 }],
    ['negative earned', { scoreMilli: 3000, rawEarnedMilli: -1, rawMaxMilli: 10_000 }],
    ['one null, one number', { scoreMilli: 3000, rawEarnedMilli: null, rawMaxMilli: 10_000 }],
  ])('rejects a bad raw pair: %s', async (_label, extra) => {
    const w = await world();
    const res = await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'P',
      periodShareBp: 1000,
      ...extra,
    });
    expect(res.status).toBe(400);
  });

  it('clearing the score clears the raw pair and scoredAt; the pair can be cleared alone', async () => {
    const w = await world();
    const ev = (
      await evaluation(
        w.agent,
        base(w, { scoreMilli: 4000, rawEarnedMilli: 8000, rawMaxMilli: 10_000 }),
      ).expect(201)
    ).body.evaluation;
    const cleared = (
      await w.agent
        .patch(`/api/evaluations/${ev.id}`)
        .send({ rawEarnedMilli: null, rawMaxMilli: null })
        .expect(200)
    ).body.evaluation;
    expect(cleared).toMatchObject({ scoreMilli: 4000, rawEarnedMilli: null, rawMaxMilli: null });
    const again = (
      await w.agent
        .patch(`/api/evaluations/${ev.id}`)
        .send({ rawEarnedMilli: 8000, rawMaxMilli: 10_000 })
        .expect(200)
    ).body.evaluation;
    expect(again.scoreMilli).toBe(4000); // 8000/10000 of 5000 = 4000
    const none = (
      await w.agent.patch(`/api/evaluations/${ev.id}`).send({ scoreMilli: null }).expect(200)
    ).body.evaluation;
    expect(none).toMatchObject({
      scoreMilli: null,
      rawEarnedMilli: null,
      rawMaxMilli: null,
      scoredAt: null,
    });
  });

  it('can be deleted; deleting never touches the activity', async () => {
    const w = await world();
    const act = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: w.subject.id, title: 'Parcial', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    const ev = (await evaluation(w.agent, base(w, { activityId: act.id })).expect(201)).body
      .evaluation;
    await w.agent.delete(`/api/evaluations/${ev.id}`).expect(204);
    expect(await prisma.evaluation.count()).toBe(0);
    expect(await prisma.activity.count()).toBe(1);
    await w.agent.delete(`/api/evaluations/${ev.id}`).expect(404);
  });
});

describe('the activity link', () => {
  it('an activity may back several evaluations; a general or foreign-subject one cannot link', async () => {
    const w = await world();
    const other = (
      await w.agent.post('/api/subjects').send({ periodId: w.period.id, name: 'Redes' }).expect(201)
    ).body.subject;
    const act = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: w.subject.id, title: 'Entrega', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    const general = (
      await w.agent
        .post('/api/activities')
        .send({ title: 'Trámite', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    const otherAct = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: other.id, title: 'Otra', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    const mk = (activityId: string, name: string) =>
      evaluation(w.agent, {
        subjectId: w.subject.id,
        gradingPeriodId: w.cuts[0]!.id,
        name,
        periodShareBp: 1000,
        activityId,
      });
    await mk(act.id, 'A1').expect(201);
    await mk(act.id, 'A2').expect(201);
    expect((await mk(general.id, 'G')).status).toBe(400);
    expect((await mk(otherAct.id, 'O')).status).toBe(400);
    expect((await mk(randomUUID(), 'Z')).status).toBe(404);
  });

  it('deleting the activity only unlinks its evaluations', async () => {
    const w = await world();
    const act = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: w.subject.id, title: 'Entrega', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'A1',
      periodShareBp: 1000,
      activityId: act.id,
      scoreMilli: 4000,
    }).expect(201);
    await w.agent.delete(`/api/activities/${act.id}`).expect(204);
    const row = await prisma.evaluation.findFirstOrThrow();
    expect(row.activityId).toBeNull();
    expect(row.subjectId).toBe(w.subject.id);
    expect(row.scoreMilli).toBe(4000);
  });

  it('a linked activity cannot change subject (409); an unlinked one can', async () => {
    const w = await world();
    const other = (
      await w.agent.post('/api/subjects').send({ periodId: w.period.id, name: 'Redes' }).expect(201)
    ).body.subject;
    const act = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: w.subject.id, title: 'Entrega', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    const ev = (
      await evaluation(w.agent, {
        subjectId: w.subject.id,
        gradingPeriodId: w.cuts[0]!.id,
        name: 'A1',
        periodShareBp: 1000,
        activityId: act.id,
      }).expect(201)
    ).body.evaluation;
    const res = await w.agent.patch(`/api/activities/${act.id}`).send({ subjectId: other.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVITY_LINKED_TO_EVALUATION');
    await w.agent.patch(`/api/activities/${act.id}`).send({ title: 'Entrega 2' }).expect(200); // other edits are fine
    await w.agent.patch(`/api/evaluations/${ev.id}`).send({ activityId: null }).expect(200);
    await w.agent.patch(`/api/activities/${act.id}`).send({ subjectId: other.id }).expect(200);
  });

  it('the database itself refuses a link across subjects', async () => {
    const w = await world();
    const other = (
      await w.agent.post('/api/subjects').send({ periodId: w.period.id, name: 'Redes' }).expect(201)
    ).body.subject;
    const otherAct = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: other.id, title: 'Otra', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    const ev = (
      await evaluation(w.agent, {
        subjectId: w.subject.id,
        gradingPeriodId: w.cuts[0]!.id,
        name: 'A1',
        periodShareBp: 1000,
      }).expect(201)
    ).body.evaluation;
    await expect(
      prisma.evaluation.update({ where: { id: ev.id }, data: { activityId: otherAct.id } }),
    ).rejects.toThrow();
  });
});

describe('deleting around grades', () => {
  it('a subject with evaluations is not deleted (409)', async () => {
    const w = await world();
    const ev = (
      await evaluation(w.agent, {
        subjectId: w.subject.id,
        gradingPeriodId: w.cuts[0]!.id,
        name: 'P',
        periodShareBp: 1000,
      }).expect(201)
    ).body.evaluation;
    const res = await w.agent.delete(`/api/subjects/${w.subject.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBJECT_HAS_EVALUATIONS');
    await w.agent.delete(`/api/evaluations/${ev.id}`).expect(204);
    await w.agent.delete(`/api/subjects/${w.subject.id}`).expect(204);
  });

  it('a period with grading configuration cannot leave its study (409); it can move between studies', async () => {
    const w = await world();
    const res = await w.agent.patch(`/api/periods/${w.period.id}`).send({ studyTrackId: null });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_HAS_GRADING');
    const second = (
      await w.agent
        .post('/api/study-tracks')
        .send({ name: 'Otro', type: 'OTHER_ACADEMIC' })
        .expect(201)
    ).body.studyTrack;
    await w.agent
      .patch(`/api/periods/${w.period.id}`)
      .send({ studyTrackId: second.id })
      .expect(200);
    expect((await prisma.gradingProfile.findFirstOrThrow()).periodId).toBe(w.period.id);
    // A period with no grading at all still goes back to "no study".
    const plain = (
      await w.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Sin notas', studyTrackId: second.id })
        .expect(201)
    ).body.period;
    await w.agent.patch(`/api/periods/${plain.id}`).send({ studyTrackId: null }).expect(200);
  });

  it('an archived study keeps its grades readable', async () => {
    const w = await world();
    await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'P',
      periodShareBp: 10_000,
      scoreMilli: 4000,
    }).expect(201);
    await w.agent.post(`/api/study-tracks/${w.track.id}/archive`).expect(200);
    const res = await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200);
    expect(res.body.evaluations).toHaveLength(1);
    expect(res.body.profile.passMilli).toBe(3000);
    expect(
      (await w.agent.get(`/api/periods/${w.period.id}/grading`).expect(200)).body.gradingPeriods,
    ).toHaveLength(3);
  });

  it('a period without evaluations deletes with its configuration (no orphans)', async () => {
    const w = await world();
    await w.agent.delete(`/api/subjects/${w.subject.id}`).expect(204);
    await w.agent.delete(`/api/periods/${w.period.id}`).expect(204);
    expect(await prisma.gradingProfile.count()).toBe(0);
    expect(await prisma.gradingPeriod.count()).toBe(0);
  });
});

describe('GET /subjects/:id/grades', () => {
  it('without a scale: no summary', async () => {
    const w = await world('a@example.com', { grading: false });
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(res).toMatchObject({
      subjectId: w.subject.id,
      profile: null,
      evaluations: [],
      summary: null,
    });
  });

  it('computes the exact figures: current, remaining, what is needed', async () => {
    const w = await world();
    const mk = (cut: number, score: number | null) =>
      evaluation(w.agent, {
        subjectId: w.subject.id,
        gradingPeriodId: w.cuts[cut]!.id,
        name: `C${cut + 1}`,
        periodShareBp: 10_000,
        ...(score !== null && { scoreMilli: score }),
      }).expect(201);
    await mk(0, 4000);
    await mk(1, 3000);
    await mk(2, null);
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(res.summary).toMatchObject({
      complete: true,
      currentMilli: 3500,
      currentPasses: true,
      evaluatedWeightUnits: 60_000_000,
      remainingWeightUnits: 40_000_000,
      required: { status: 'NEEDED', requiredMilli: 2250 },
    });
  });

  it('flags incomplete weights as an estimate', async () => {
    const w = await world();
    await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'P',
      periodShareBp: 5000,
      scoreMilli: 4000,
    }).expect(201);
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(res.summary.complete).toBe(false);
    expect(res.summary.undefinedWeightUnits).toBeGreaterThan(0);
  });
});

describe('the database refuses what the service would', () => {
  it('rejects a bad scale, a bad weight and a raw pair without a score', async () => {
    const w = await world();
    const cut = w.cuts[0]!.id;
    const ok = {
      userId: w.user.id,
      periodId: w.period.id,
      subjectId: w.subject.id,
      gradingPeriodId: cut,
      name: 'P',
      periodShareBp: 1000,
    };
    await expect(
      prisma.gradingProfile.create({
        data: { userId: w.user.id, periodId: randomUUID(), ...SCALE_05, minMilli: 5000 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.evaluation.create({ data: { ...ok, periodShareBp: 10_001 } }),
    ).rejects.toThrow();
    await expect(
      prisma.evaluation.create({ data: { ...ok, scoreMilli: 100_001, scoredAt: new Date() } }),
    ).rejects.toThrow();
    // a score without scoredAt, a raw pair without a score, a half raw pair, earned above max
    await expect(prisma.evaluation.create({ data: { ...ok, scoreMilli: 3000 } })).rejects.toThrow();
    await expect(
      prisma.evaluation.create({ data: { ...ok, rawEarnedMilli: 1, rawMaxMilli: 2 } }),
    ).rejects.toThrow();
    await expect(
      prisma.evaluation.create({
        data: { ...ok, scoreMilli: 3000, scoredAt: new Date(), rawEarnedMilli: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.evaluation.create({
        data: { ...ok, scoreMilli: 3000, scoredAt: new Date(), rawEarnedMilli: 3, rawMaxMilli: 2 },
      }),
    ).rejects.toThrow();
    await prisma.evaluation.create({
      data: { ...ok, scoreMilli: 3000, scoredAt: new Date(), rawEarnedMilli: 1, rawMaxMilli: 2 },
    });
  });

  it('rejects a cut or a subject of another period', async () => {
    const w = await world();
    const p2 = (
      await w.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Otro', studyTrackId: w.track.id })
        .expect(201)
    ).body.period;
    const s2 = (
      await w.agent.post('/api/subjects').send({ periodId: p2.id, name: 'Otra' }).expect(201)
    ).body.subject;
    const base = { userId: w.user.id, name: 'P', periodShareBp: 1000 };
    // the cut belongs to period 1, the evaluation says period 2
    await expect(
      prisma.evaluation.create({
        data: { ...base, periodId: p2.id, subjectId: s2.id, gradingPeriodId: w.cuts[0]!.id },
      }),
    ).rejects.toThrow();
    // the subject belongs to period 2, the evaluation says period 1
    await expect(
      prisma.evaluation.create({
        data: { ...base, periodId: w.period.id, subjectId: s2.id, gradingPeriodId: w.cuts[0]!.id },
      }),
    ).rejects.toThrow();
  });
});
