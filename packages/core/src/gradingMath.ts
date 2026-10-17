/**
 * GRADE ARITHMETIC (D36). Pure and exact: every score is an integer in thousandths ("milli": 4.3 → 4300) and every weight an
 * integer in basis points (1 bp = 0.01 %). The weight of one evaluation in the FINAL grade is `finalShareBp × periodShareBp`
 * (a "unit": 100 % = 10 000 × 10 000 = WEIGHT_UNIT_TOTAL). Sums are BigInt, so no scale or amount of evaluations can overflow
 * or drift, and the pass mark is always compared EXACTLY. Rounding exists only to show a number (`roundMilli`, `ceilMilli`): a
 * rounded figure is never fed back into a comparison, because an institution may round differently (or not at all).
 *
 * With K = Σ score × weight (graded), E = Σ weight (graded) and R = total − E (still to be graded):
 *   current = K / E · final with the rest scored p = (K + R·p) / total · needed p for a target T = (T·total − K) / R.
 * When the split of the final grade is not fully defined (`complete` false) every figure is an ESTIMATE: the undefined part counts as "still
 * to be graded".
 */

/** 100 % of the final grade, in units (10 000 bp of the cut × 10 000 bp of the evaluation). */
export const WEIGHT_UNIT_TOTAL = 100_000_000;

export interface GradeScale {
  minMilli: number;
  maxMilli: number;
  passMilli: number;
}

/** A cut with its weight in the final grade. */
export interface CutWeight {
  id: string;
  finalShareBp: number;
}

/** An evaluation of ONE subject. `scoreMilli` null = not graded yet. */
export interface WeightedScore {
  gradingPeriodId: string;
  periodShareBp: number;
  scoreMilli: number | null;
}

export interface SubjectGradeSummary {
  /** The weights of the subject's evaluations add up to exactly 100 % of the final grade. */
  complete: boolean;
  /** Weight (units) of every evaluation, graded or not. */
  definedWeightUnits: number;
  /** WEIGHT_UNIT_TOTAL − defined: weight nobody has described yet. */
  undefinedWeightUnits: number;
  /** Weight (units) of the evaluations that already have a score. */
  evaluatedWeightUnits: number;
  /** WEIGHT_UNIT_TOTAL − evaluated: what can still change the final grade. */
  remainingWeightUnits: number;
  /** Weighted average of the graded evaluations, rounded to a milli for display only; null while nothing is graded. */
  currentMilli: number | null;
  /** The EXACT current average is at or above the pass mark; null while nothing is graded. */
  currentPasses: boolean | null;
}

export type RequiredScore =
  /** Passing is guaranteed even if everything left is scored the scale minimum. */
  | { status: 'SECURED' }
  /** The target cannot be reached even with the scale maximum on everything left. */
  | { status: 'IMPOSSIBLE' }
  /** The least average score (milli, rounded UP) the rest needs to reach the target. */
  | { status: 'NEEDED'; requiredMilli: number };

interface Totals {
  /** Σ score × weight, graded only (milli · units). */
  k: bigint;
  /** Σ weight, graded only. */
  e: bigint;
  /** The weight (units) whose split is DEFINED: see `totals`. */
  defined: bigint;
}

const TOTAL = BigInt(WEIGHT_UNIT_TOTAL);

/**
 * What is DEFINED is how the final grade is split, not how much is graded:
 *  - a cut WITHOUT evaluations is fully defined — its whole weight is simply pending (nobody has to describe anything);
 *  - a cut whose evaluations add up to 100 % is fully defined;
 *  - a cut whose evaluations add up to LESS than 100 % is only partly defined (the rest of that cut has no description yet).
 * So three cuts of 30/30/40 are fully defined even when none has a grade.
 */
function totals(cuts: readonly CutWeight[], items: readonly WeightedScore[]): Totals {
  const share = new Map(cuts.map((c) => [c.id, BigInt(c.finalShareBp)]));
  const described = new Map<string, bigint>(); // Σ periodShareBp of the evaluations of each cut
  let k = 0n;
  let e = 0n;
  for (const item of items) {
    const cut = share.get(item.gradingPeriodId);
    if (cut === undefined) continue; // an evaluation of a cut that is not in the list weighs nothing
    described.set(
      item.gradingPeriodId,
      (described.get(item.gradingPeriodId) ?? 0n) + BigInt(item.periodShareBp),
    );
    if (item.scoreMilli !== null) {
      const weight = cut * BigInt(item.periodShareBp);
      e += weight;
      k += BigInt(item.scoreMilli) * weight;
    }
  }
  let defined = 0n;
  for (const [id, cut] of share) defined += cut * (described.get(id) ?? 10_000n);
  return { k, e, defined };
}

/** Integer division rounding half up, for non-negative operands. */
const divRound = (n: bigint, d: bigint): bigint => (2n * n + d) / (2n * d);
const divCeil = (n: bigint, d: bigint): bigint => (n + d - 1n) / d;

export function summarizeSubjectGrade(
  scale: GradeScale,
  cuts: readonly CutWeight[],
  items: readonly WeightedScore[],
): SubjectGradeSummary {
  const { k, e, defined } = totals(cuts, items);
  return {
    complete: defined === TOTAL,
    definedWeightUnits: Number(defined),
    undefinedWeightUnits: Number(TOTAL - defined),
    evaluatedWeightUnits: Number(e),
    remainingWeightUnits: Number(TOTAL - e),
    currentMilli: e === 0n ? null : Number(divRound(k, e)),
    currentPasses: e === 0n ? null : k >= BigInt(scale.passMilli) * e,
  };
}

/**
 * The ACCUMULATED grade: what the graded evaluations have already contributed to the FINAL grade, with everything still pending
 * counting as 0 for now (K / total). It is NOT the average of what was graded (that is `currentMilli`): 4.5 on 30 % of the final
 * grade accumulates 1.35. Rounded for display only; null while nothing is graded.
 */
export function accumulatedMilli(
  cuts: readonly CutWeight[],
  items: readonly WeightedScore[],
): number | null {
  const { k, e } = totals(cuts, items);
  return e === 0n ? null : Number(divRound(k, TOTAL));
}

/** The final grade (milli, rounded for display) if everything still to be graded scored `assumedMilli`. */
export function projectedFinalMilli(
  cuts: readonly CutWeight[],
  items: readonly WeightedScore[],
  assumedMilli: number,
): number {
  const { k, e } = totals(cuts, items);
  return Number(divRound(k + (TOTAL - e) * BigInt(assumedMilli), TOTAL));
}

/**
 * What the rest of the subject has to score for the final grade to reach `targetMilli` (the pass mark by default). Exact: a final
 * grade that lands exactly on the target reaches it. Only the figure shown is rounded (up, to the milli).
 */
export function requiredScore(
  scale: GradeScale,
  cuts: readonly CutWeight[],
  items: readonly WeightedScore[],
  targetMilli: number = scale.passMilli,
): RequiredScore {
  const { k, e } = totals(cuts, items);
  const remaining = TOTAL - e;
  const need = BigInt(targetMilli) * TOTAL - k; // the rest must contribute at least this (milli · units)
  if (remaining * BigInt(scale.minMilli) >= need) return { status: 'SECURED' };
  if (remaining * BigInt(scale.maxMilli) < need) return { status: 'IMPOSSIBLE' };
  return { status: 'NEEDED', requiredMilli: Number(divCeil(need, remaining)) };
}

const stepOf = (decimals: number) => 10 ** (3 - decimals);

/** Round a score to `decimals` (0..3) for display, half up. NEVER compare the result with the pass mark. */
export function roundMilli(milli: number, decimals: number): number {
  const step = stepOf(decimals);
  return Math.floor((milli + step / 2) / step) * step;
}

/** Round UP to `decimals`: what "you need" is shown as, so the figure shown is always enough. */
export function ceilMilli(milli: number, decimals: number): number {
  const step = stepOf(decimals);
  return Math.ceil(milli / step) * step;
}

/**
 * "18 of 20" on a scale that starts at 0 → the score in milli (half up). On a scale that does not start at 0 there is no honest
 * automatic conversion, so it returns null and the student gives the score.
 */
export function rawToScoreMilli(
  scale: Pick<GradeScale, 'minMilli' | 'maxMilli'>,
  rawEarnedMilli: number,
  rawMaxMilli: number,
): number | null {
  if (scale.minMilli !== 0 || rawMaxMilli <= 0) return null;
  return Number(divRound(BigInt(rawEarnedMilli) * BigInt(scale.maxMilli), BigInt(rawMaxMilli)));
}

/**
 * What a cut that has a grade adds to the FINAL grade: its grade × its weight in the final grade (4.5 on a 30 % cut → 1.35).
 * It is not the average of the cut. Milli, half up; for display only, never stored.
 */
export function cutContributionMilli(finalShareBp: number, gradeMilli: number): number {
  return Number(divRound(BigInt(gradeMilli) * BigInt(finalShareBp), 10_000n));
}
