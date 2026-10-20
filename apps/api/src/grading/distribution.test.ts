import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, periodInput, prisma, resetDb, signUp } from '../../test/helpers.js';

const app: Express = buildApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };

/** A study with Ciberseguridad 30/30/40 and Redes 50/50 in the same period. */
async function world(email = 'ana@example.com') {
  const { agent } = await signUp(app, email);
  const study = (
    await agent.post('/api/study-tracks').send({ name: 'Ing', type: 'UNIVERSITY' }).expect(201)
  ).body.studyTrack;
  const period = (
    await agent
      .post('/api/periods')
      .send({ ...periodInput, studyTrackId: study.id })
      .expect(201)
  ).body.period;
  const setup = async (name: string, shares: number[], withScale: boolean) => {
    const subject = (
      await agent.post('/api/subjects').send({ periodId: period.id, name }).expect(201)
    ).body.subject;
    const res = await agent
      .post(`/api/subjects/${subject.id}/grading/setup`)
      .send({
        ...(withScale && { profile: SCALE }),
        gradingPeriods: shares.map((finalShareBp, i) => ({ name: `Corte ${i + 1}`, finalShareBp })),
      })
      .expect(201);
    return { subject, cuts: res.body.gradingPeriods as { id: string; finalShareBp: number }[] };
  };
  const ciber = await setup('Ciberseguridad', [3000, 3000, 4000], true);
  const redes = await setup('Redes', [5000, 5000], false);
  return { agent, ciber, redes };
}
const body = (cuts: { id: string }[], shares: number[]) => ({
  gradingPeriods: cuts.map((c, i) => ({ id: c.id, finalShareBp: shares[i]! })),
});
const sharesOf = async (subjectId: string) =>
  (await prisma.gradingPeriod.findMany({ where: { subjectId }, orderBy: { position: 'asc' } })).map(
    (c) => c.finalShareBp,
  );

describe('POST /api/subjects/:id/grading-periods/distribution — the joint distribution', () => {
  it('30/30/40 → 40/30/30 in one atomic update, other subjects untouched', async () => {
    const w = await world();
    const res = await w.agent
      .post(`/api/subjects/${w.ciber.subject.id}/grading-periods/distribution`)
      .send(body(w.ciber.cuts, [4000, 3000, 3000]))
      .expect(200);
    expect(res.body.gradingPeriods.map((c: { finalShareBp: number }) => c.finalShareBp)).toEqual([
      4000, 3000, 3000,
    ]);
    expect(await sharesOf(w.ciber.subject.id)).toEqual([4000, 3000, 3000]);
    expect(await sharesOf(w.redes.subject.id)).toEqual([5000, 5000]);
  });

  it('40/40/20 is valid', async () => {
    const w = await world();
    await w.agent
      .post(`/api/subjects/${w.ciber.subject.id}/grading-periods/distribution`)
      .send(body(w.ciber.cuts, [4000, 4000, 2000]))
      .expect(200);
    expect(await sharesOf(w.ciber.subject.id)).toEqual([4000, 4000, 2000]);
  });

  it('never accepts negatives, below or above 100 %: nothing changes', async () => {
    const w = await world();
    for (const shares of [
      [6000, 5000, -1000],
      [3000, 3000, 3000],
      [6000, 6000, 2000],
      [0, 5000, 5000],
    ]) {
      await w.agent
        .post(`/api/subjects/${w.ciber.subject.id}/grading-periods/distribution`)
        .send(body(w.ciber.cuts, shares))
        .expect(400);
    }
    expect(await sharesOf(w.ciber.subject.id)).toEqual([3000, 3000, 4000]);
  });

  it('a cut of another subject, a missing cut or an extra one is refused; no cross-subject effect', async () => {
    const w = await world();
    const foreign = [...w.ciber.cuts.slice(0, 2), w.redes.cuts[0]!];
    const res = await w.agent
      .post(`/api/subjects/${w.ciber.subject.id}/grading-periods/distribution`)
      .send(body(foreign, [3000, 3000, 4000]));
    expect(res.status).toBe(404);
    const missing = await w.agent
      .post(`/api/subjects/${w.ciber.subject.id}/grading-periods/distribution`)
      .send(body(w.ciber.cuts.slice(0, 2), [5000, 5000]));
    expect(missing.status).toBe(400);
    const unknown = await w.agent
      .post(`/api/subjects/${w.ciber.subject.id}/grading-periods/distribution`)
      .send({ gradingPeriods: [{ id: randomUUID(), finalShareBp: 10000 }] });
    expect(unknown.status).toBe(404);
    expect(await sharesOf(w.ciber.subject.id)).toEqual([3000, 3000, 4000]);
    expect(await sharesOf(w.redes.subject.id)).toEqual([5000, 5000]);
  });

  it('a subject of another account looks like one that does not exist', async () => {
    const w = await world();
    const other = await world('b@example.com');
    const a = await w.agent
      .post(`/api/subjects/${other.ciber.subject.id}/grading-periods/distribution`)
      .send(body(other.ciber.cuts, [4000, 3000, 3000]));
    const b = await w.agent
      .post(`/api/subjects/${randomUUID()}/grading-periods/distribution`)
      .send(body(other.ciber.cuts, [4000, 3000, 3000]));
    expect(a.status).toBe(404);
    expect(a.body).toEqual(b.body);
    expect(await sharesOf(other.ciber.subject.id)).toEqual([3000, 3000, 4000]);
  });

  it('concurrent edits never leave a total different from 100 %', async () => {
    const w = await world();
    const sets = [
      [4000, 3000, 3000],
      [2000, 3000, 5000],
      [3500, 3500, 3000],
      [1000, 1000, 8000],
    ];
    const results = await Promise.all(
      sets.map((s) =>
        w.agent
          .post(`/api/subjects/${w.ciber.subject.id}/grading-periods/distribution`)
          .send(body(w.ciber.cuts, s)),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const final = await sharesOf(w.ciber.subject.id);
    expect(final.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(sets).toContainEqual(final); // one whole edit won, never a mix
  });

  it('evaluations inside a cut keep their own rule: never above 100 %, may stay below', async () => {
    const w = await world();
    const cut = w.ciber.cuts[0]!.id;
    const add = (name: string, periodShareBp: number) =>
      w.agent
        .post('/api/evaluations')
        .send({ subjectId: w.ciber.subject.id, gradingPeriodId: cut, name, periodShareBp });
    await add('Parcial', 4000).then((r) => expect(r.status).toBe(201)); // 40 %: 60 % still undefined, valid
    await add('Taller', 2000).then((r) => expect(r.status).toBe(201));
    await add('Final del corte', 4001).then((r) => expect(r.status).toBe(400));
    await add('Final del corte', 4000).then((r) => expect(r.status).toBe(201));
  });
});
