import { describe, expect, it } from 'vitest';
import { replaceCutWeightsSchema } from './grading.js';
import { distributeWeights } from './gradingDistribution.js';

const row = (key: string, pct: number | null, auto = false) => ({
  key,
  bp: pct === null ? null : pct * 100,
  auto,
});
const pct = (r: ReturnType<typeof distributeWeights>) =>
  r.rows.map((x) => (x.bp === null ? null : x.bp / 100));

describe('distributeWeights — the cuts of a subject', () => {
  it('30 / 30 / AUTO → 40', () => {
    const r = distributeWeights([row('a', 30), row('b', 30), row('c', null, true)]);
    expect(pct(r)).toEqual([30, 30, 40]);
    expect(r.status).toBe('COMPLETE');
  });
  it('40 / 30 / AUTO → 30 (the others are NOT redistributed proportionally)', () => {
    expect(pct(distributeWeights([row('a', 40), row('b', 30), row('c', null, true)]))).toEqual([
      40, 30, 30,
    ]);
  });
  it('20 / 30 / AUTO → 50', () => {
    expect(pct(distributeWeights([row('a', 20), row('b', 30), row('c', null, true)]))).toEqual([
      20, 30, 50,
    ]);
  });
  it('60 / 50 / AUTO → OVER_100, the automatic one is never negative', () => {
    const r = distributeWeights([row('a', 60), row('b', 50), row('c', null, true)]);
    expect(r.status).toBe('OVER_100');
    expect(r.definedBp).toBe(11000);
    expect(r.remainingBp).toBe(-1000);
    expect(r.rows[2]!.bp).toBeNull();
  });
  it('30 / 30 / 30 all manual → UNDER_100 (the 10 % is not placed anywhere)', () => {
    const r = distributeWeights([row('a', 30), row('b', 30), row('c', 30)]);
    expect(r.status).toBe('UNDER_100');
    expect(r.remainingBp).toBe(1000);
  });
  it('25 / 25 / 25 / 25 → COMPLETE', () => {
    expect(distributeWeights([25, 25, 25, 25].map((p, i) => row('k' + i, p))).status).toBe(
      'COMPLETE',
    );
  });
  it('a single grade of 100 % is complete', () => {
    expect(distributeWeights([row('a', 100)]).status).toBe('COMPLETE');
  });
  it('40 / 40 / AUTO → 20; an automatic cut left with nothing is not valid', () => {
    expect(pct(distributeWeights([row('a', 40), row('b', 40), row('c', null, true)]))).toEqual([
      40, 40, 20,
    ]);
    expect(distributeWeights([row('a', 50), row('b', 50), row('c', null, true)]).status).toBe(
      'AUTO_NO_ROOM',
    );
  });
  it('an empty manual cut, or two automatic ones, is incomplete', () => {
    expect(distributeWeights([row('a', 30), row('b', null), row('c', null, true)]).status).toBe(
      'INCOMPLETE',
    );
    expect(distributeWeights([row('a', null, true), row('b', null, true)]).status).toBe(
      'INCOMPLETE',
    );
  });
});

describe('replaceCutWeightsSchema', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const body = (...bp: number[]) => ({
    gradingPeriods: bp.map((finalShareBp, i) => ({ id: id(i + 1), finalShareBp })),
  });
  it('accepts exactly 100 %', () => {
    expect(replaceCutWeightsSchema.safeParse(body(4000, 3000, 3000)).success).toBe(true);
    expect(replaceCutWeightsSchema.safeParse(body(4000, 4000, 2000)).success).toBe(true);
  });
  it('refuses below / above 100 %, negatives, repeated ids and extra fields', () => {
    expect(replaceCutWeightsSchema.safeParse(body(3000, 3000, 3000)).success).toBe(false);
    expect(replaceCutWeightsSchema.safeParse(body(6000, 5000, -1000)).success).toBe(false);
    expect(replaceCutWeightsSchema.safeParse(body(6000, 6000)).success).toBe(false);
    const dup = {
      gradingPeriods: [
        { id: id(1), finalShareBp: 5000 },
        { id: id(1), finalShareBp: 5000 },
      ],
    };
    expect(replaceCutWeightsSchema.safeParse(dup).success).toBe(false);
    expect(replaceCutWeightsSchema.safeParse({ ...body(10000), userId: id(9) }).success).toBe(
      false,
    );
  });
});
