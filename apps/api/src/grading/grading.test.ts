import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
            .post(`/api/subjects/${subject.id}/grading-periods`)
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
      .post(`/api/subjects/${w.subject.id}/grading-periods`)
      .send({ name: 'Corte 1', finalShareBp: 3000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADING_NOT_CONFIGURED');
  });

  it('are numbered by the server and listed in order', async () => {
    const w = await world();
    expect(w.cuts).toHaveLength(3);
    const list = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(list.gradingPeriods.map((c: { position: number }) => c.position)).toEqual([1, 2, 3]);
  });

  it('cannot add up to more than 100 %', async () => {
    const w = await world(); // already 100 %
    const res = await w.agent
      .post(`/api/subjects/${w.subject.id}/grading-periods`)
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
      .post(`/api/subjects/${w.subject.id}/grading-periods`)
      .send({ name: 'Corte 1', finalShareBp: 3000 })
      .expect(201);
  });

  it.each([[0], [10_001], [-5], [12.5]])('rejects the weight %s', async (finalShareBp) => {
    const w = await world('a@example.com', { grading: false });
    await w.agent.post(`/api/periods/${w.period.id}/grading`).send(SCALE_05).expect(201);
    await w.agent
      .post(`/api/subjects/${w.subject.id}/grading-periods`)
      .send({ name: 'C', finalShareBp })
      .expect(400);
  });

  it('concurrent creations cannot pass 100 %', async () => {
    const w = await world('a@example.com', { grading: false });
    await w.agent.post(`/api/periods/${w.period.id}/grading`).send(SCALE_05).expect(201);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        w.agent
          .post(`/api/subjects/${w.subject.id}/grading-periods`)
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

    // A cut of ANOTHER subject (even of the same period) is refused: each subject has its own cuts.
    const w = await world('b@example.com');
    const other = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period.id, name: 'Anatomía' })
        .expect(201)
    ).body.subject;
    const otherCut = (
      await w.agent
        .post(`/api/subjects/${other.id}/grading-periods`)
        .send({ name: 'C', finalShareBp: 10_000 })
        .expect(201)
    ).body.gradingPeriod;
    const cross = await evaluation(w.agent, base(w, { gradingPeriodId: otherCut.id }));
    expect(cross.status).toBe(400);
    expect(cross.body.error.details.fields.gradingPeriodId).toEqual([
      'El corte debe ser de esta materia.',
    ]);
    expect(await prisma.evaluation.count()).toBe(0);
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
    const otherCut = (
      await w.agent
        .post(`/api/subjects/${other.id}/grading-periods`)
        .send({ name: 'Nota final', finalShareBp: 10_000 })
        .expect(201)
    ).body.gradingPeriod;
    await evaluation(
      w.agent,
      base(w, { subjectId: other.id, gradingPeriodId: otherCut.id, periodShareBp: 10_000 }),
    ).expect(201);
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
        .post(`/api/subjects/${w2.subject.id}/grading-periods`)
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
        .post(`/api/subjects/${w2.subject.id}/grading-periods`)
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
    expect(res.body.gradingPeriods).toHaveLength(3);
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

describe('the database keeps each cut inside its subject', () => {
  it('an evaluation cannot use a cut of another subject, and a cut cannot name a subject of another period', async () => {
    const w = await world();
    const other = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period.id, name: 'Anatomía' })
        .expect(201)
    ).body.subject;
    // same user, same period, but the cut is Farmacología's and the evaluation is Anatomía's
    await expect(
      prisma.evaluation.create({
        data: {
          userId: w.user.id,
          periodId: w.period.id,
          subjectId: other.id,
          gradingPeriodId: w.cuts[0]!.id,
          name: 'P',
          periodShareBp: 1000,
        },
      }),
    ).rejects.toThrow();
    const p2 = (
      await w.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Otro', studyTrackId: w.track.id })
        .expect(201)
    ).body.period;
    await expect(
      prisma.gradingPeriod.create({
        data: {
          userId: w.user.id,
          periodId: p2.id,
          subjectId: w.subject.id,
          name: 'X',
          position: 9,
          finalShareBp: 1000,
        },
      }),
    ).rejects.toThrow(); // the subject belongs to another period
    // (subjectId, position) is unique, but two subjects may both have a "position 1"
    await prisma.gradingPeriod.create({
      data: {
        userId: w.user.id,
        periodId: w.period.id,
        subjectId: other.id,
        name: 'C1',
        position: 1,
        finalShareBp: 10_000,
      },
    });
    await expect(
      prisma.gradingPeriod.create({
        data: {
          userId: w.user.id,
          periodId: w.period.id,
          subjectId: other.id,
          name: 'C1 bis',
          position: 1,
          finalShareBp: 10,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('raw "earned/max" never leaves a stale canonical score', () => {
  const scale17 = { minMilli: 1000, maxMilli: 7000, passMilli: 4000, decimals: 1 };

  /** One scored evaluation (existing score `score`) on the given scale. */
  async function scored(scale: object, score: number) {
    const w = await world('a@example.com', { grading: false });
    await w.agent.post(`/api/periods/${w.period.id}/grading`).send(scale).expect(201);
    const cut = (
      await w.agent
        .post(`/api/subjects/${w.subject.id}/grading-periods`)
        .send({ name: 'N', finalShareBp: 10_000 })
        .expect(201)
    ).body.gradingPeriod;
    const ev = (
      await evaluation(w.agent, {
        subjectId: w.subject.id,
        gradingPeriodId: cut.id,
        name: 'P',
        periodShareBp: 5000,
        scoreMilli: score,
      }).expect(201)
    ).body.evaluation;
    return { w, ev };
  }
  const row = (id: string) => prisma.evaluation.findUniqueOrThrow({ where: { id } });
  const RAW = { rawEarnedMilli: 18_000, rawMaxMilli: 20_000 };

  it('scale 1–7: a raw pair alone is refused and nothing changes', async () => {
    const { w, ev } = await scored(scale17, 4000);
    const before = await row(ev.id);
    const res = await w.agent.patch(`/api/evaluations/${ev.id}`).send(RAW);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.scoreMilli).toBeDefined();
    expect(await row(ev.id)).toEqual(before);
  });

  it('scale 1–7: the pair with an explicit score keeps both', async () => {
    const { w, ev } = await scored(scale17, 4000);
    const res = await w.agent.patch(`/api/evaluations/${ev.id}`).send({ ...RAW, scoreMilli: 6500 });
    expect(res.status).toBe(200);
    expect(res.body.evaluation).toMatchObject({ scoreMilli: 6500, ...RAW });
  });

  it('scale 0–5: the pair alone RECOMPUTES the score from the new pair (never the old one)', async () => {
    const { w, ev } = await scored(SCALE_05, 3000);
    const res = await w.agent.patch(`/api/evaluations/${ev.id}`).send(RAW);
    expect(res.status).toBe(200);
    expect(res.body.evaluation).toMatchObject({ scoreMilli: 4500, ...RAW });
    expect((await row(ev.id)).scoredAt).not.toBeNull();
  });

  it('clearing only the pair keeps the canonical score; clearing the score clears pair and scoredAt', async () => {
    const { w, ev } = await scored(SCALE_05, 3000);
    await w.agent.patch(`/api/evaluations/${ev.id}`).send(RAW).expect(200);
    const kept = await w.agent
      .patch(`/api/evaluations/${ev.id}`)
      .send({ rawEarnedMilli: null, rawMaxMilli: null })
      .expect(200);
    expect(kept.body.evaluation).toMatchObject({
      scoreMilli: 4500,
      rawEarnedMilli: null,
      rawMaxMilli: null,
    });
    await w.agent.patch(`/api/evaluations/${ev.id}`).send(RAW).expect(200);
    const cleared = await w.agent
      .patch(`/api/evaluations/${ev.id}`)
      .send({ scoreMilli: null })
      .expect(200);
    expect(cleared.body.evaluation).toMatchObject({
      scoreMilli: null,
      rawEarnedMilli: null,
      rawMaxMilli: null,
      scoredAt: null,
    });
  });

  it('an update without the pair keeps the stored score', async () => {
    const { w, ev } = await scored(scale17, 4000);
    const res = await w.agent.patch(`/api/evaluations/${ev.id}`).send({ name: 'Otro' }).expect(200);
    expect(res.body.evaluation.scoreMilli).toBe(4000);
  });
});

describe('a foreign key that fails reports what vanished', () => {
  /** Runs `fn` just before the insert of the evaluation, inside the real transaction (a deterministic race). */
  function beforeInsert(fn: () => Promise<unknown>) {
    const original = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((cb: unknown, opts: unknown) =>
      original(async (tx: { evaluation: { create: (a: unknown) => Promise<unknown> } }) => {
        const create = tx.evaluation.create.bind(tx.evaluation);
        tx.evaluation.create = async (args) => {
          await fn();
          return create(args);
        };
        return (cb as (t: unknown) => Promise<unknown>)(tx);
      }, opts)) as never);
    return spy;
  }
  afterEach(() => vi.restoreAllMocks());

  it('the linked activity vanished: the activity 404, not "cut not found"', async () => {
    const w = await world();
    const act = (
      await w.agent
        .post('/api/activities')
        .send({ subjectId: w.subject.id, title: 'Entrega', dueDate: '2099-03-15' })
        .expect(201)
    ).body.activity;
    beforeInsert(() => prisma.activity.delete({ where: { id: act.id } }));
    const res = await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'P',
      periodShareBp: 1000,
      activityId: act.id,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Actividad no encontrada.');
    expect(await prisma.evaluation.count()).toBe(0);
  });

  it('the cut vanished: the cut 404', async () => {
    const w = await world();
    beforeInsert(() => prisma.gradingPeriod.delete({ where: { id: w.cuts[2]!.id } }));
    const res = await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[2]!.id,
      name: 'P',
      periodShareBp: 1000,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Corte no encontrado.');
  });
});

describe('maintenance guard: the hand-written Evaluation → Activity key', () => {
  it('exists in the database exactly as the migration writes it (Prisma cannot represent it)', async () => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'Evaluation_activityId_subjectId_fkey'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.def).toContain(
      'FOREIGN KEY ("activityId", "subjectId") REFERENCES "Activity"(id, "subjectId")',
    );
    expect(rows[0]!.def).toContain('ON DELETE SET NULL ("activityId")');
  });

  it('is still written in the migration, the source of truth for it', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = readdirSync(dir)
      .filter((d) => d.endsWith('_grading_foundation'))
      .map((d) => readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toContain('"Evaluation_activityId_subjectId_fkey"');
    expect(sql).toContain('ON DELETE SET NULL ("activityId")');
  });
});

describe('POST /subjects/:id/grading/setup (atomic, per subject)', () => {
  const profile = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
  const cuts = [
    { name: 'Corte 1', finalShareBp: 3000 },
    { name: 'Corte 2', finalShareBp: 3000 },
    { name: 'Corte 3', finalShareBp: 4000 },
  ];
  const setup = (a: Agent, subjectId: string, body: object) =>
    a.post(`/api/subjects/${subjectId}/grading/setup`).send(body);

  it('the first subject creates the scale of the period and its own cuts, numbered in order', async () => {
    const w = await world('a@example.com', { grading: false });
    const res = await setup(w.agent, w.subject.id, { profile, gradingPeriods: cuts }).expect(201);
    expect(res.body.profile).toMatchObject(profile);
    expect(res.body.gradingPeriods.map((c: { position: number }) => c.position)).toEqual([1, 2, 3]);
    expect(
      res.body.gradingPeriods.every((c: { subjectId: string }) => c.subjectId === w.subject.id),
    ).toBe(true);
    expect(await prisma.gradingPeriod.count()).toBe(3);
  });

  it('without a scale it needs one; with a scale it does not ask for it again (and ignores a second one)', async () => {
    const w = await world('a@example.com', { grading: false });
    const missing = await setup(w.agent, w.subject.id, { gradingPeriods: cuts });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fields.profile).toBeDefined();
    expect(await prisma.gradingPeriod.count()).toBe(0);
    await setup(w.agent, w.subject.id, { profile, gradingPeriods: cuts }).expect(201);

    const other = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period.id, name: 'Anatomía' })
        .expect(201)
    ).body.subject;
    const second = await setup(w.agent, other.id, {
      gradingPeriods: [{ name: 'Nota final', finalShareBp: 10_000 }],
    }).expect(201);
    expect(second.body.profile.passMilli).toBe(3000); // the period's scale
    // a different scale sent by another subject does NOT replace the period's
    const third = (
      await w.agent.post('/api/subjects').send({ periodId: w.period.id, name: 'Ética' }).expect(201)
    ).body.subject;
    const ignored = await setup(w.agent, third.id, {
      profile: { minMilli: 0, maxMilli: 100_000, passMilli: 60_000, decimals: 0 },
      gradingPeriods: [{ name: 'Nota final', finalShareBp: 10_000 }],
    }).expect(201);
    expect(ignored.body.profile).toMatchObject(profile);
    expect(await prisma.gradingProfile.count()).toBe(1);
  });

  it('is all or nothing: a second setup of the same subject, an untracked period and bad weights leave nothing behind', async () => {
    const w = await world('a@example.com', { grading: false });
    const over = await setup(w.agent, w.subject.id, {
      profile,
      gradingPeriods: [...cuts, { name: 'Extra', finalShareBp: 1 }],
    });
    expect(over.status).toBe(400);
    expect(await prisma.gradingProfile.count()).toBe(0);
    await setup(w.agent, w.subject.id, { profile, gradingPeriods: cuts }).expect(201);
    const again = await setup(w.agent, w.subject.id, { profile, gradingPeriods: cuts });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('GRADING_EXISTS');
    expect(await prisma.gradingPeriod.count()).toBe(3);

    const u = await world('b@example.com', { tracked: false });
    const untracked = await setup(u.agent, u.subject.id, { profile, gradingPeriods: cuts });
    expect(untracked.status).toBe(409);
    expect(untracked.body.error.code).toBe('PERIOD_NOT_TRACKED');
  });

  it('a failure while creating a cut rolls the profile back too', async () => {
    const w = await world('a@example.com', { grading: false });
    const original = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(prisma, '$transaction').mockImplementation(((cb: unknown, opts: unknown) =>
      original(async (tx: { gradingPeriod: { create: (a: unknown) => Promise<unknown> } }) => {
        const create = tx.gradingPeriod.create.bind(tx.gradingPeriod);
        let calls = 0;
        tx.gradingPeriod.create = async (args) => {
          if (++calls === 2) throw new Error('boom');
          return create(args);
        };
        return (cb as (t: unknown) => Promise<unknown>)(tx);
      }, opts)) as never);
    const res = await setup(w.agent, w.subject.id, { profile, gradingPeriods: cuts });
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    expect(await prisma.gradingProfile.count()).toBe(0);
    expect(await prisma.gradingPeriod.count()).toBe(0);
  });

  it.each([
    ['no cuts', { profile, gradingPeriods: [] }],
    ['unknown field', { profile, gradingPeriods: cuts, userId: randomUUID() }],
    [
      'too many cuts',
      {
        profile,
        gradingPeriods: Array.from({ length: 13 }, (_, i) => ({
          name: `C${i}`,
          finalShareBp: 100,
        })),
      },
    ],
    ['bad scale', { profile: { ...profile, passMilli: 9000 }, gradingPeriods: cuts }],
    [
      'cuts that do not reach 100 %',
      {
        profile,
        gradingPeriods: [
          { name: 'A', finalShareBp: 3000 },
          { name: 'B', finalShareBp: 3000 },
          { name: 'C', finalShareBp: 3000 },
        ],
      },
    ],
    [
      'cuts over 100 %',
      {
        profile,
        gradingPeriods: [
          { name: 'A', finalShareBp: 5000 },
          { name: 'B', finalShareBp: 4000 },
          { name: 'C', finalShareBp: 2000 },
        ],
      },
    ],
  ])('rejects %s', async (_l, body) => {
    const w = await world('a@example.com', { grading: false });
    await setup(w.agent, w.subject.id, body).expect(400);
    expect(await prisma.gradingProfile.count()).toBe(0);
  });

  it('two subjects configured at the same time end with ONE scale and their own independent cuts', async () => {
    const w = await world('a@example.com', { grading: false });
    const other = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period.id, name: 'Anatomía' })
        .expect(201)
    ).body.subject;
    const results = await Promise.all([
      setup(w.agent, w.subject.id, { profile, gradingPeriods: cuts }),
      setup(w.agent, other.id, {
        profile,
        gradingPeriods: [{ name: 'Nota final', finalShareBp: 10_000 }],
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await prisma.gradingProfile.count()).toBe(1);
    expect(await prisma.gradingPeriod.count({ where: { subjectId: w.subject.id } })).toBe(3);
    expect(await prisma.gradingPeriod.count({ where: { subjectId: other.id } })).toBe(1);
  });
});

describe('each subject has its own cuts; only the scale is the period’s (D36 revised)', () => {
  const profile = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
  const setupCuts = (a: Agent, subjectId: string, shares: number[], withProfile = false) =>
    a
      .post(`/api/subjects/${subjectId}/grading/setup`)
      .send({
        ...(withProfile && { profile }),
        gradingPeriods: shares.map((finalShareBp, i) => ({ name: `Corte ${i + 1}`, finalShareBp })),
      })
      .expect(201);
  const direct = (a: Agent, subjectId: string, cutId: string, scoreMilli: number) =>
    a
      .post('/api/evaluations')
      .send({ subjectId, gradingPeriodId: cutId, isCutGrade: true, scoreMilli })
      .expect(201);
  const grades = async (a: Agent, subjectId: string) =>
    (await a.get(`/api/subjects/${subjectId}/grades`).expect(200)).body;

  /** Farmacología 30/30/40, Bases de datos 25/35/40, Seminario 100 %: the same period, the same scale. */
  async function three() {
    const w = await world('a@example.com', { grading: false });
    const mk = async (name: string) =>
      (await w.agent.post('/api/subjects').send({ periodId: w.period.id, name }).expect(201)).body
        .subject;
    const bases = await mk('Bases de datos');
    const seminario = await mk('Seminario');
    const a = await setupCuts(w.agent, w.subject.id, [3000, 3000, 4000], true);
    const b = await setupCuts(w.agent, bases.id, [2500, 3500, 4000]);
    const c = await setupCuts(w.agent, seminario.id, [10_000]);
    return {
      w,
      bases,
      seminario,
      a: a.body.gradingPeriods,
      b: b.body.gradingPeriods,
      c: c.body.gradingPeriods,
    };
  }

  it('three distributions coexist in one period: no shared rows, one shared scale', async () => {
    const { w, bases, seminario, a, b, c } = await three();
    expect(await prisma.gradingProfile.count()).toBe(1);
    expect(new Set([...a, ...b, ...c].map((x: { id: string }) => x.id)).size).toBe(7); // 3 + 3 + 1, none shared
    const ga = await grades(w.agent, w.subject.id);
    const gb = await grades(w.agent, bases.id);
    const gc = await grades(w.agent, seminario.id);
    expect(ga.gradingPeriods.map((x: { finalShareBp: number }) => x.finalShareBp)).toEqual([
      3000, 3000, 4000,
    ]);
    expect(gb.gradingPeriods.map((x: { finalShareBp: number }) => x.finalShareBp)).toEqual([
      2500, 3500, 4000,
    ]);
    expect(gc.gradingPeriods.map((x: { finalShareBp: number }) => x.finalShareBp)).toEqual([
      10_000,
    ]);
    expect(ga.profile).toEqual(gb.profile);
    expect(gb.profile).toEqual(gc.profile);
    // every response carries ONLY the cuts of its own subject
    for (const [g, subject] of [
      [ga, w.subject],
      [gb, bases],
      [gc, seminario],
    ] as const)
      expect(g.gradingPeriods.every((x: { subjectId: string }) => x.subjectId === subject.id)).toBe(
        true,
      );
  });

  it('the same grades give each subject its own result (3.91, 3.975, 4.3)', async () => {
    const { w, bases, seminario, a, b, c } = await three();
    for (const [subjectId, cuts] of [
      [w.subject.id, a],
      [bases.id, b],
    ] as const)
      for (const [i, score] of [3200, 4500, 4000].entries())
        await direct(w.agent, subjectId, cuts[i].id, score);
    await direct(w.agent, seminario.id, c[0].id, 4300);
    const sa = (await grades(w.agent, w.subject.id)).summary;
    const sb = (await grades(w.agent, bases.id)).summary;
    const sc = (await grades(w.agent, seminario.id)).summary;
    expect(sa.currentMilli).toBe(3910); // 3.2·30 % + 4.5·30 % + 4.0·40 %
    expect(sb.currentMilli).toBe(3975); // 3.2·25 % + 4.5·35 % + 4.0·40 % = 0.8 + 1.575 + 1.6
    expect(sc.currentMilli).toBe(4300);
    for (const s of [sa, sb, sc])
      expect(s).toMatchObject({
        complete: true,
        remainingWeightUnits: 0,
        evaluatedWeightUnits: 100_000_000,
      });
  });

  it('editing or deleting a cut of one subject never touches another subject', async () => {
    const { w, bases, a, b } = await three();
    const before = await grades(w.agent, bases.id);
    await w.agent
      .patch(`/api/grading-periods/${a[0].id}`)
      .send({ name: 'Primero', finalShareBp: 2000 })
      .expect(200);
    await w.agent
      .post(`/api/subjects/${w.subject.id}/grading-periods`)
      .send({ name: 'Extra', finalShareBp: 1000 })
      .expect(201);
    await w.agent.delete(`/api/grading-periods/${a[1].id}`).expect(204);
    expect(await grades(w.agent, bases.id)).toEqual(before);
    expect(b).toHaveLength(3);
    // weights are checked PER SUBJECT: Bases de datos is full (100 %), Farmacología has room again
    await w.agent
      .post(`/api/subjects/${bases.id}/grading-periods`)
      .send({ name: 'Más', finalShareBp: 1 })
      .expect(400);
  });

  it('a subject can never use, edit or delete a cut of another subject', async () => {
    const { w, bases, a, b } = await three();
    const own = await evaluation(w.agent, {
      subjectId: bases.id,
      gradingPeriodId: a[0].id,
      name: 'P',
      periodShareBp: 1000,
    });
    expect(own.status).toBe(400); // a cut of another subject of the same period
    const directCross = await w.agent
      .post('/api/evaluations')
      .send({ subjectId: bases.id, gradingPeriodId: a[0].id, isCutGrade: true, scoreMilli: 4000 });
    expect(directCross.status).toBe(400);
    const ev = (await direct(w.agent, bases.id, b[0].id, 3000)).body.evaluation;
    const move = await w.agent
      .patch(`/api/evaluations/${ev.id}`)
      .send({ gradingPeriodId: a[0].id, name: 'x' });
    expect(move.status).toBe(400);
    expect(await prisma.evaluation.count()).toBe(1);
  });

  it('a subject whose cuts are not configured yet asks for them, and a subject keeps its cuts when another one is deleted', async () => {
    const w = await world('a@example.com');
    const other = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period.id, name: 'Anatomía' })
        .expect(201)
    ).body.subject;
    const g = await grades(w.agent, other.id);
    expect(g.profile).not.toBeNull(); // the scale already exists
    expect(g.gradingPeriods).toEqual([]); // the 30/30/40 of Farmacología is NOT inherited
    expect(g.summary).toBeNull();
    await setupCuts(w.agent, other.id, [5000, 5000]);
    await w.agent.delete(`/api/subjects/${other.id}`).expect(204); // configuration only: it goes with the subject
    expect(await prisma.gradingPeriod.count()).toBe(3); // Farmacología's cuts are untouched
  });

  it('a subject of ANOTHER period of the same study has its own scale', async () => {
    const w = await world();
    const p2 = (
      await w.agent
        .post('/api/periods')
        .send({ ...periodInput, name: 'Otro', studyTrackId: w.track.id })
        .expect(201)
    ).body.period;
    const s2 = (
      await w.agent.post('/api/subjects').send({ periodId: p2.id, name: 'Anatomía' }).expect(201)
    ).body.subject;
    const res = await grades(w.agent, s2.id);
    expect(res.profile).toBeNull();
    expect(res.gradingPeriods).toEqual([]);
  });
});

describe('GET /subjects/:id/grades carries the period and the study (derived by the server)', () => {
  it('a tracked period: its name, its study and the study type', async () => {
    const w = await world();
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(res.period).toEqual({ id: w.period.id, name: w.period.name, studyTrackId: w.track.id });
    expect(res.studyTrack).toEqual({
      id: w.track.id,
      name: 'Medicina',
      type: 'UNIVERSITY',
      status: 'ACTIVE',
    });
  });

  it.each(['SCHOOL', 'OTHER_ACADEMIC'])('the type is the real one: %s', async (type) => {
    const w = await world('a@example.com', { grading: false });
    await w.agent.patch(`/api/study-tracks/${w.track.id}`).send({ type }).expect(200);
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(res.studyTrack.type).toBe(type);
  });

  it('an untracked period: no study and no type', async () => {
    const w = await world('a@example.com', { tracked: false });
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(res.period.studyTrackId).toBeNull();
    expect(res.studyTrack).toBeNull();
  });

  it('an archived study says so (its grades stay readable)', async () => {
    const w = await world();
    await w.agent.post(`/api/study-tracks/${w.track.id}/archive`).expect(200);
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(res.studyTrack.status).toBe('ARCHIVED');
  });

  it('exposes nothing of the owner', async () => {
    const w = await world();
    const text = JSON.stringify(
      (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body,
    );
    expect(text).not.toContain(w.user.id);
  });
});

describe('the direct grade of a cut (subject → cut → grade)', () => {
  const direct = (w: Awaited<ReturnType<typeof world>>, cut: number, extra: object = {}) =>
    w.agent.post('/api/evaluations').send({
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[cut]!.id,
      isCutGrade: true,
      ...extra,
    });

  it('needs no name and no weight: the server names it and gives it 100 % of the cut', async () => {
    const w = await world();
    const res = await direct(w, 1, { scoreMilli: 4500 }).expect(201);
    expect(res.body.evaluation).toMatchObject({
      name: 'Nota de Corte 2',
      periodShareBp: 10_000,
      scoreMilli: 4500,
      isCutGrade: true,
      activityId: null,
    });
    expect((await prisma.evaluation.findFirstOrThrow()).isCutGrade).toBe(true);
  });

  it('EXAMPLE: 30/30/40 with only the second cut at 4.5 is NOT an estimate', async () => {
    const w = await world();
    await direct(w, 1, { scoreMilli: 4500 }).expect(201);
    const { summary } = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200))
      .body;
    expect(summary).toMatchObject({
      complete: true,
      undefinedWeightUnits: 0,
      evaluatedWeightUnits: 30_000_000,
      remainingWeightUnits: 70_000_000,
      currentMilli: 4500,
      required: { status: 'NEEDED', requiredMilli: 2358 },
    });
  });

  it('accepts points on a scale that starts at 0 (the server converts), and requires a grade', async () => {
    const w = await world();
    const res = await direct(w, 0, { rawEarnedMilli: 18_000, rawMaxMilli: 20_000 }).expect(201);
    expect(res.body.evaluation).toMatchObject({ scoreMilli: 4500, rawEarnedMilli: 18_000 });
    for (const body of [{}, { scoreMilli: null }]) {
      const none = await direct(w, 1, body);
      expect(none.status).toBe(400);
    }
    expect((await direct(w, 2, { scoreMilli: 5001 })).status).toBe(400);
  });

  it.each([
    ['name', 'Parcial'],
    ['periodShareBp', 5000],
  ])('refuses to be sent %s (it is the server’s)', async (key, value) => {
    const w = await world();
    const res = await direct(w, 0, { scoreMilli: 4000, [key as string]: value });
    expect(res.status).toBe(400);
    expect(await prisma.evaluation.count()).toBe(0);
  });

  it('a cut is either a direct grade or broken down, never both (and only one direct grade)', async () => {
    const w = await world();
    await direct(w, 0, { scoreMilli: 4000 }).expect(201);
    const second = await direct(w, 0, { scoreMilli: 3000 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CUT_GRADE_EXISTS');
    const detailed = await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 5000,
    });
    expect(detailed.status).toBe(409);
    expect(detailed.body.error.code).toBe('CUT_HAS_DIRECT_GRADE');
    await evaluation(w.agent, {
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[1]!.id,
      name: 'Parcial',
      periodShareBp: 5000,
    }).expect(201);
    const over = await direct(w, 1, { scoreMilli: 3000 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('CUT_HAS_EVALUATIONS');
    // moving a detailed evaluation into a cut that has a direct grade is refused too
    const moving = (await prisma.evaluation.findFirstOrThrow({ where: { isCutGrade: false } })).id;
    const move = await w.agent
      .patch(`/api/evaluations/${moving}`)
      .send({ gradingPeriodId: w.cuts[0]!.id });
    expect(move.status).toBe(409);
  });

  it('only its grade changes; it cannot be emptied (it is removed instead); other subjects are independent', async () => {
    const w = await world();
    const other = (
      await w.agent
        .post('/api/subjects')
        .send({ periodId: w.period.id, name: 'Anatomía' })
        .expect(201)
    ).body.subject;
    const ev = (await direct(w, 0, { scoreMilli: 4000 }).expect(201)).body.evaluation;
    const edit = await w.agent
      .patch(`/api/evaluations/${ev.id}`)
      .send({ scoreMilli: 3500 })
      .expect(200);
    expect(edit.body.evaluation.scoreMilli).toBe(3500);
    for (const body of [
      { name: 'x' },
      { periodShareBp: 5000 },
      { gradingPeriodId: w.cuts[1]!.id },
      { scoreMilli: null },
    ]) {
      expect(
        (await w.agent.patch(`/api/evaluations/${ev.id}`).send(body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    const otherCut = (
      await w.agent
        .post(`/api/subjects/${other.id}/grading-periods`)
        .send({ name: 'Nota final', finalShareBp: 10_000 })
        .expect(201)
    ).body.gradingPeriod;
    await w.agent
      .post('/api/evaluations')
      .send({
        subjectId: other.id,
        gradingPeriodId: otherCut.id,
        isCutGrade: true,
        scoreMilli: 2000,
      })
      .expect(201);
    await w.agent.delete(`/api/evaluations/${ev.id}`).expect(204);
    await direct(w, 0, { scoreMilli: 4800 }).expect(201); // the cut is free again
  });

  it('the database keeps the marker honest: 100 % of the cut, scored, no activity, one per subject and cut', async () => {
    const w = await world();
    const base = {
      userId: w.user.id,
      periodId: w.period.id,
      subjectId: w.subject.id,
      gradingPeriodId: w.cuts[0]!.id,
      name: 'Nota de Corte 1',
      isCutGrade: true,
      scoreMilli: 4000,
      scoredAt: new Date(),
    };
    await expect(
      prisma.evaluation.create({ data: { ...base, periodShareBp: 5000 } }),
    ).rejects.toThrow();
    await expect(
      prisma.evaluation.create({
        data: { ...base, periodShareBp: 10_000, scoreMilli: null, scoredAt: null },
      }),
    ).rejects.toThrow();
    await prisma.evaluation.create({ data: { ...base, periodShareBp: 10_000 } });
    await expect(
      prisma.evaluation.create({ data: { ...base, periodShareBp: 10_000 } }),
    ).rejects.toThrow();
  });
});

describe('every cut graded directly (QA case)', () => {
  it('3.2 / 4.5 / 4.0 on 30/30/40: fully graded, nothing pending, no estimate', async () => {
    const w = await world();
    for (const [i, scoreMilli] of [3200, 4500, 4000].entries())
      await w.agent
        .post('/api/evaluations')
        .send({
          subjectId: w.subject.id,
          gradingPeriodId: w.cuts[i]!.id,
          isCutGrade: true,
          scoreMilli,
        })
        .expect(201);
    const res = (await w.agent.get(`/api/subjects/${w.subject.id}/grades`).expect(200)).body;
    expect(
      res.evaluations.every(
        (e: { isCutGrade: boolean; periodShareBp: number }) =>
          e.isCutGrade && e.periodShareBp === 10_000,
      ),
    ).toBe(true);
    expect(res.summary).toMatchObject({
      complete: true,
      undefinedWeightUnits: 0,
      evaluatedWeightUnits: 100_000_000,
      remainingWeightUnits: 0,
      currentMilli: 3910,
      currentPasses: true,
      required: { status: 'SECURED' },
    });
  });
});
