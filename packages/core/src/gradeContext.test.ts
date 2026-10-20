import { describe, expect, it } from 'vitest';
import {
  buildGradeContext,
  buildSubjectGradeProgress,
  countCutsWithGrade,
  cutGradeMilli,
  effectiveFinalWeightUnits,
} from './gradeContext.js';
import { formatUnitsPercent } from './gradingUi.js';
import { calculateRadarStatus } from './radar.js';

const pct = (units: number) => formatUnitsPercent(units);
const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
const ctxOf = (rows: Parameters<typeof buildGradeContext>[0]) => buildGradeContext(rows, SCALE);
const cuts = [
  { id: 'c1', finalShareBp: 3000 },
  { id: 'c2', finalShareBp: 3000 },
  { id: 'c3', finalShareBp: 4000 },
];
const item = (
  gradingPeriodId: string,
  periodShareBp: number,
  scoreMilli: number | null,
  isCutGrade = false,
) => ({
  gradingPeriodId,
  periodShareBp,
  scoreMilli,
  isCutGrade,
});

describe('the weight of an evaluation in the final grade (integers, never a float)', () => {
  it('30 % cut × 40 % evaluation = 12 %', () => {
    expect(effectiveFinalWeightUnits(3000, 4000)).toBe(12_000_000);
    expect(pct(effectiveFinalWeightUnits(3000, 4000))).toBe('12 %');
  });
  it('40 % cut × 25 % evaluation = 10 %', () => {
    expect(pct(effectiveFinalWeightUnits(4000, 2500))).toBe('10 %');
  });
  it('a direct cut grade (100 % of its cut) weighs exactly what its cut weighs: 30 %', () => {
    expect(pct(effectiveFinalWeightUnits(3000, 10_000))).toBe('30 %');
    expect(effectiveFinalWeightUnits(3000, 10_000)).toBe(30_000_000);
  });
  it('detailed: Parcial 40 % = 12 % and Quiz 20 % = 6 % of a 30 % cut; a half is not rounded away', () => {
    expect(pct(effectiveFinalWeightUnits(3000, 4000))).toBe('12 %');
    expect(pct(effectiveFinalWeightUnits(3000, 2000))).toBe('6 %');
    expect(pct(effectiveFinalWeightUnits(2500, 3000))).toBe('7.5 %');
  });
});

describe('the grade context of an activity (0..N linked evaluations)', () => {
  const row = (id: string, share: number, cutShare: number, score: number | null) => ({
    id,
    name: id,
    cutName: 'Corte 1',
    isCutGrade: false,
    scoreMilli: score,
    periodShareBp: share,
    cutFinalShareBp: cutShare,
  });
  it('without evaluations there is NO context at all', () => {
    expect(buildGradeContext([], SCALE)).toBeUndefined();
  });
  it('one evaluation: its own weight, its score kept', () => {
    const c = buildGradeContext([row('Parcial', 4000, 3000, 4200)], SCALE)!;
    expect(c.evaluations).toHaveLength(1);
    expect(c.evaluations[0]).toMatchObject({ finalWeightUnits: 12_000_000, scoreMilli: 4200 });
    expect(c.totalFinalWeightUnits).toBe(12_000_000);
  });
  it('several: none is chosen over another, the weights add up', () => {
    const c = ctxOf([
      row('Parcial', 4000, 3000, null),
      row('Quiz', 2000, 3000, 3800),
      row('Taller', 5000, 4000, null),
    ])!;
    expect(c.evaluations.map((e) => e.name)).toEqual(['Parcial', 'Quiz', 'Taller']);
    expect(c.totalFinalWeightUnits).toBe(12_000_000 + 6_000_000 + 20_000_000);
    expect(pct(c.totalFinalWeightUnits)).toBe('38 %');
  });
});

describe('the Radar stays temporal: the weight is context only', () => {
  it('two activities identical in deadline are classified the same whatever they weigh', () => {
    const base = { dueAt: '2026-10-20T15:00:00.000Z', hasTime: true, status: 'PENDING' } as never;
    const now = new Date('2026-10-18T12:00:00.000Z');
    const light = {
      ...(base as object),
      gradeContext: ctxOf([
        {
          id: 'a',
          name: 'Taller',
          cutName: 'Corte 1',
          isCutGrade: false,
          scoreMilli: null,
          periodShareBp: 500,
          cutFinalShareBp: 1000,
        },
      ]),
    };
    const heavy = {
      ...(base as object),
      gradeContext: ctxOf([
        {
          id: 'b',
          name: 'Final',
          cutName: 'Corte 3',
          isCutGrade: false,
          scoreMilli: null,
          periodShareBp: 10_000,
          cutFinalShareBp: 3000,
        },
      ]),
    };
    expect(calculateRadarStatus(light as never, now)).toBe(
      calculateRadarStatus(heavy as never, now),
    );
    expect(light.gradeContext!.totalFinalWeightUnits).toBeLessThan(
      heavy.gradeContext!.totalFinalWeightUnits,
    );
  });
});

describe('the grade of a subject for the Progress', () => {
  it('null without a scale or without cuts (never a made-up 0.0)', () => {
    expect(buildSubjectGradeProgress(null, cuts, [])).toBeNull();
    expect(buildSubjectGradeProgress(SCALE, [], [])).toBeNull();
  });
  it('configured but nothing graded: no accumulated figure, 0 of 3 cuts', () => {
    const g = buildSubjectGradeProgress(SCALE, cuts, [])!;
    expect(g).toMatchObject({
      accumulatedMilli: null,
      currentMilli: null,
      cutsWithGrade: 0,
      cutsTotal: 3,
      maxMilli: 5000,
      decimals: 1,
      complete: true,
    });
  });
  it('partial: Corte 1 = 4.0 → accumulated 1.2, average 4.0, 1 of 3 cuts', () => {
    const g = buildSubjectGradeProgress(SCALE, cuts, [item('c1', 10_000, 4000, true)])!;
    expect(g).toMatchObject({
      accumulatedMilli: 1200,
      currentMilli: 4000,
      cutsWithGrade: 1,
      cutsTotal: 3,
    });
    expect(g.evaluatedWeightUnits).toBe(30_000_000);
    expect(g.remainingWeightUnits).toBe(70_000_000);
  });
  it('complete: 3.2 / 4.5 / 4.0 → 3.9, 3 of 3 cuts', () => {
    const g = buildSubjectGradeProgress(SCALE, cuts, [
      item('c1', 10_000, 3200, true),
      item('c2', 10_000, 4500, true),
      item('c3', 10_000, 4000, true),
    ])!;
    expect(g.accumulatedMilli).toBe(3910);
    expect(g.cutsWithGrade).toBe(3);
    expect(g.remainingWeightUnits).toBe(0);
  });
  it('a cut broken down counts as graded only when its weights are 100 % and all graded', () => {
    expect(cutGradeMilli([item('c1', 4000, 4000), item('c1', 6000, null)])).toBeNull();
    expect(cutGradeMilli([item('c1', 4000, 4000), item('c1', 3000, 5000)])).toBeNull(); // only 70 %
    expect(cutGradeMilli([item('c1', 4000, 4000), item('c1', 6000, 3000)])).toBe(3400);
    expect(countCutsWithGrade(cuts, [item('c1', 4000, 4000), item('c1', 6000, 3000)])).toBe(1);
  });
  it('different distributions per subject are read with their own cuts', () => {
    const other = [{ id: 'x', finalShareBp: 10_000 }];
    const a = buildSubjectGradeProgress(SCALE, cuts, [item('c1', 10_000, 4000, true)])!;
    const b = buildSubjectGradeProgress(SCALE, other, [item('x', 10_000, 4000, true)])!;
    expect(a.accumulatedMilli).toBe(1200);
    expect(b.accumulatedMilli).toBe(4000);
  });
});
