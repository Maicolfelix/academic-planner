import { describe, expect, it } from 'vitest';
import {
  WEIGHT_UNIT_TOTAL,
  accumulatedMilli,
  ceilMilli,
  projectedFinalMilli,
  rawToScoreMilli,
  requiredScore,
  roundMilli,
  summarizeSubjectGrade,
  type CutWeight,
  type GradeScale,
  type WeightedScore,
} from './gradingMath.js';
import {
  createEvaluationSchema,
  createGradingProfileSchema,
  updateEvaluationSchema,
} from './grading.js';

const UUID = '5b0e3a52-3f7c-4a4e-9a0e-1c2d3e4f5a6b';
const scale05: GradeScale = { minMilli: 0, maxMilli: 5000, passMilli: 3000 };
const scale100: GradeScale = { minMilli: 0, maxMilli: 100_000, passMilli: 60_000 };
const scale120: GradeScale = { minMilli: 1000, maxMilli: 20_000, passMilli: 10_000 };

// A university: three cuts 30/30/40, each with evaluations that add up to 100 %.
const cuts: CutWeight[] = [
  { id: 'c1', finalShareBp: 3000 },
  { id: 'c2', finalShareBp: 3000 },
  { id: 'c3', finalShareBp: 4000 },
];
const full = (scores: (number | null)[]): WeightedScore[] =>
  cuts.map((c, i) => ({
    gradingPeriodId: c.id,
    periodShareBp: 10_000,
    scoreMilli: scores[i] ?? null,
  }));

describe('summarizeSubjectGrade', () => {
  it('0–5: current average, evaluated and remaining weight (30/30/40)', () => {
    const s = summarizeSubjectGrade(scale05, cuts, full([4000, 3000, null]));
    expect(s.complete).toBe(true);
    expect(s.evaluatedWeightUnits).toBe(0.6 * WEIGHT_UNIT_TOTAL);
    expect(s.remainingWeightUnits).toBe(0.4 * WEIGHT_UNIT_TOTAL);
    expect(s.currentMilli).toBe(3500); // (4·30 + 3·30) / 60
    expect(s.currentPasses).toBe(true);
  });

  it('0–100 and 1–20 scales use the same arithmetic', () => {
    expect(summarizeSubjectGrade(scale100, cuts, full([80_000, 40_000, null])).currentMilli).toBe(
      60_000,
    );
    expect(summarizeSubjectGrade(scale120, cuts, full([20_000, 10_000, null])).currentMilli).toBe(
      15_000,
    );
  });

  it('nothing graded: no current grade, no verdict', () => {
    const s = summarizeSubjectGrade(scale05, cuts, full([null, null, null]));
    expect(s.currentMilli).toBeNull();
    expect(s.currentPasses).toBeNull();
    expect(s.evaluatedWeightUnits).toBe(0);
  });

  it('incomplete weights are flagged and the undefined part is reported', () => {
    const items: WeightedScore[] = [
      { gradingPeriodId: 'c1', periodShareBp: 5000, scoreMilli: 4000 },
      { gradingPeriodId: 'c3', periodShareBp: 10_000, scoreMilli: null },
    ];
    const s = summarizeSubjectGrade(scale05, cuts, items);
    expect(s.complete).toBe(false);
    expect(s.definedWeightUnits).toBe(0.15 * WEIGHT_UNIT_TOTAL + 0.4 * WEIGHT_UNIT_TOTAL);
    expect(s.undefinedWeightUnits).toBe(0.45 * WEIGHT_UNIT_TOTAL);
  });

  it('an evaluation of an unknown cut weighs nothing', () => {
    const s = summarizeSubjectGrade(scale05, cuts, [
      { gradingPeriodId: 'zzz', periodShareBp: 10_000, scoreMilli: 5000 },
    ]);
    expect(s.evaluatedWeightUnits).toBe(0);
  });

  it('the pass mark is compared EXACTLY: 2.97 displays as 3.0 but does not pass', () => {
    const s = summarizeSubjectGrade(scale05, cuts, full([2970, 2970, 2970]));
    expect(s.currentMilli).toBe(2970);
    expect(roundMilli(s.currentMilli!, 1)).toBe(3000); // what a student may see…
    expect(s.currentPasses).toBe(false); // …never changes the verdict
    expect(summarizeSubjectGrade(scale05, cuts, full([3000, 3000, 3000])).currentPasses).toBe(true);
  });
});

describe('accumulatedMilli (what the graded evaluations already add to the final grade)', () => {
  it('is not the average of what was graded: 4.5 on 30 % accumulates 1.35 (shown 1.4 with one decimal)', () => {
    const items = full([4500, null, null]);
    expect(summarizeSubjectGrade(scale05, cuts, items).currentMilli).toBe(4500); // the average of the graded part
    expect(accumulatedMilli(cuts, items)).toBe(1350); // the accumulated, over the whole final grade
  });
  it('adds the cuts: 4.0·30 % + 3.0·30 % + 5.0·40 % = 4.1', () => {
    expect(accumulatedMilli(cuts, full([4000, 3000, 5000]))).toBe(4100);
  });
  it('nothing graded: null; pending counts 0 while something is', () => {
    expect(accumulatedMilli(cuts, full([null, null, null]))).toBeNull();
    expect(accumulatedMilli(cuts, full([5000, null, null]))).toBe(1500);
  });
  it('a 100 % grade accumulates the score itself', () => {
    expect(
      accumulatedMilli(
        [{ id: 'c1', finalShareBp: 10_000 }],
        [{ gradingPeriodId: 'c1', periodShareBp: 10_000, scoreMilli: 3700 }],
      ),
    ).toBe(3700);
  });
});

describe('requiredScore', () => {
  it('how much the last cut needs (0–5, pass 3.0)', () => {
    // 4.0·30 + 3.0·30 = 210; need 300 → the last 40 % must give 90/40 = 2.25
    expect(requiredScore(scale05, cuts, full([4000, 3000, null]))).toEqual({
      status: 'NEEDED',
      requiredMilli: 2250,
    });
  });

  it('rounds the figure UP: a shown score is always enough', () => {
    // 5.0·30 + 1.0·30 = 180; need 300 → 120/40 = 3.0 exactly
    expect(requiredScore(scale05, cuts, full([5000, 1000, null]))).toEqual({
      status: 'NEEDED',
      requiredMilli: 3000,
    });
    // not exact: 3.3·30 % + 2.701·30 % = 1.8003 → the last 40 % needs 2.99925
    const r = requiredScore(scale05, cuts, full([3300, 2701, null]));
    expect(r).toEqual({ status: 'NEEDED', requiredMilli: 3000 }); // 2999.25 milli → up
  });

  it('hitting the target exactly reaches it (exact pass boundary)', () => {
    const r = requiredScore(scale05, cuts, full([4000, 3000, null]));
    if (r.status !== 'NEEDED') throw new Error('expected NEEDED');
    expect(
      projectedFinalMilli(cuts, full([4000, 3000, null]), r.requiredMilli),
    ).toBeGreaterThanOrEqual(3000);
    // one milli below the requirement does not reach it
    const below = projectedFinalMilli(cuts, full([4000, 3000, null]), r.requiredMilli - 1);
    expect(below).toBeLessThanOrEqual(3000);
    const exactly = requiredScore(scale05, cuts, [
      ...full([4000, 3000, null]).slice(0, 2),
      { gradingPeriodId: 'c3', periodShareBp: 10_000, scoreMilli: 2250 },
    ]);
    expect(exactly).toEqual({ status: 'SECURED' }); // 4·.3 + 3·.3 + 2.25·.4 = 3.0 → passes
  });

  it('impossible: even a perfect last cut is not enough', () => {
    expect(requiredScore(scale05, cuts, full([1000, 1000, null]))).toEqual({
      status: 'IMPOSSIBLE',
    });
  });

  it('already secured: passing even with the scale minimum on the rest', () => {
    expect(requiredScore(scale05, cuts, full([5000, 5000, null]))).toEqual({ status: 'SECURED' }); // 3.0 secured at 60 % × 5.0
  });

  it('a scale that starts above 0 counts the minimum of what is left', () => {
    // 1–20, pass 10: 60 % at 20 → 12 already; the rest at the minimum (1) adds 0.4 → 12.4 ≥ 10 → secured
    expect(requiredScore(scale120, cuts, full([20_000, 20_000, null]))).toEqual({
      status: 'SECURED',
    });
  });

  it('everything graded: the verdict is SECURED or IMPOSSIBLE, never NEEDED', () => {
    expect(requiredScore(scale05, cuts, full([3000, 3000, 3000]))).toEqual({ status: 'SECURED' });
    expect(requiredScore(scale05, cuts, full([2999, 3000, 3000]))).toEqual({
      status: 'IMPOSSIBLE',
    });
  });

  it('incomplete weights: the undefined weight counts as still to be graded', () => {
    const items: WeightedScore[] = [
      { gradingPeriodId: 'c1', periodShareBp: 10_000, scoreMilli: 4000 },
    ];
    // 4.0 · 30 % = 120; need 300; remaining 70 % → 180/70 = 2.5714… → 2572
    expect(requiredScore(scale05, cuts, items)).toEqual({ status: 'NEEDED', requiredMilli: 2572 });
    expect(summarizeSubjectGrade(scale05, cuts, items).complete).toBe(false);
  });

  it('a custom target works the same way', () => {
    expect(requiredScore(scale05, cuts, full([4000, 3000, null]), 4000)).toEqual({
      status: 'NEEDED',
      requiredMilli: 4750, // (400 − 210) / 40
    });
  });

  it('no overflow with huge numbers of evaluations (BigInt)', () => {
    const many: WeightedScore[] = Array.from({ length: 5000 }, () => ({
      gradingPeriodId: 'c1',
      periodShareBp: 2,
      scoreMilli: 100_000,
    }));
    expect(summarizeSubjectGrade(scale100, cuts, many).currentMilli).toBe(100_000);
  });
});

describe('presentation rounding', () => {
  it('rounds half up and ceils to the chosen decimals', () => {
    expect(roundMilli(3450, 1)).toBe(3500);
    expect(roundMilli(3449, 1)).toBe(3400);
    expect(roundMilli(3456, 0)).toBe(3000);
    expect(roundMilli(3456, 3)).toBe(3456);
    expect(ceilMilli(2251, 2)).toBe(2260);
    expect(ceilMilli(2250, 2)).toBe(2250);
    expect(ceilMilli(2001, 0)).toBe(3000);
  });
});

describe('rawToScoreMilli', () => {
  it('18/20 on a 0–5 scale is 4.5 and on 0–100 is 90', () => {
    expect(rawToScoreMilli(scale05, 18_000, 20_000)).toBe(4500);
    expect(rawToScoreMilli(scale100, 18_000, 20_000)).toBe(90_000);
  });
  it('a scale that does not start at 0 is not converted automatically', () => {
    expect(rawToScoreMilli(scale120, 18_000, 20_000)).toBeNull();
  });
  it('rounds half up', () => {
    expect(rawToScoreMilli(scale05, 1000, 3000)).toBe(1667);
  });
});

describe('grading schemas', () => {
  it('a profile needs min < max and pass inside the scale; decimals 0..3', () => {
    const ok = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
    expect(createGradingProfileSchema.safeParse(ok).success).toBe(true);
    expect(createGradingProfileSchema.safeParse({ ...ok, maxMilli: 0 }).success).toBe(false);
    expect(createGradingProfileSchema.safeParse({ ...ok, passMilli: 5001 }).success).toBe(false);
    expect(createGradingProfileSchema.safeParse({ ...ok, decimals: 4 }).success).toBe(false);
    expect(createGradingProfileSchema.safeParse({ ...ok, maxMilli: 100_001 }).success).toBe(false);
    expect(createGradingProfileSchema.safeParse({ ...ok, userId: 'x' }).success).toBe(false);
  });

  it('the raw pair travels whole, max > 0 and earned ≤ max', () => {
    const base = {
      subjectId: UUID,
      gradingPeriodId: UUID,
      name: 'Parcial',
      periodShareBp: 5000,
    };
    const ok = (x: object) => createEvaluationSchema.safeParse({ ...base, ...x }).success;
    expect(ok({})).toBe(true);
    expect(ok({ scoreMilli: 4000, rawEarnedMilli: 18_000, rawMaxMilli: 20_000 })).toBe(true);
    expect(ok({ scoreMilli: 4000, rawEarnedMilli: 18_000 })).toBe(false);
    expect(ok({ scoreMilli: 4000, rawEarnedMilli: 21_000, rawMaxMilli: 20_000 })).toBe(false);
    expect(ok({ scoreMilli: 4000, rawEarnedMilli: 0, rawMaxMilli: 0 })).toBe(false);
    expect(ok({ periodShareBp: 10_001 })).toBe(false);
    expect(ok({ periodShareBp: 0 })).toBe(false);
    expect(ok({ userId: UUID })).toBe(false);
    expect(
      updateEvaluationSchema.safeParse({ rawEarnedMilli: null, rawMaxMilli: null }).success,
    ).toBe(true);
    expect(updateEvaluationSchema.safeParse({ subjectId: UUID }).success).toBe(false);
    expect(updateEvaluationSchema.safeParse({}).success).toBe(false);
  });
});
