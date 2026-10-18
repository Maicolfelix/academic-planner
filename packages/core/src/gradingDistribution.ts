import { WEIGHT_BP_MAX } from './grading.js';

/**
 * How the final grade of ONE subject is split among its cuts, edited TOGETHER (so the student never does the arithmetic).
 *
 * The cuts of a subject must add up to EXACTLY 100 %. At most ONE cut is "automatic": it absorbs whatever the others leave. The
 * others are never redistributed proportionally, and nothing is hidden: what the student typed is what is saved.
 * (The evaluations INSIDE a cut follow a different rule: they may add up to less than 100 %, never to more.)
 */
export interface DistributionRow {
  key: string;
  /** What the student typed, in basis points; null while empty. Ignored for the automatic row. */
  bp: number | null;
  auto: boolean;
}

export type DistributionStatus =
  /** Adds up to exactly 100 %: can be saved. */
  | 'COMPLETE'
  /** The cuts the student defined already pass 100 %. */
  | 'OVER_100'
  /** There is no automatic cut and the cuts do not reach 100 %. */
  | 'UNDER_100'
  /** The automatic cut would be left with nothing (the others already add up to 100 %). */
  | 'AUTO_NO_ROOM'
  /** A manual cut has no valid value, or more than one cut is automatic. */
  | 'INCOMPLETE';

export interface DistributionResult {
  /** The same rows with the automatic one resolved (null when it cannot be). */
  rows: { key: string; bp: number | null; auto: boolean }[];
  /** What the manual cuts add up to. */
  definedBp: number;
  /** 100 % minus what is defined (negative when it passes). */
  remainingBp: number;
  status: DistributionStatus;
}

export function distributeWeights(rows: readonly DistributionRow[]): DistributionResult {
  const autos = rows.filter((r) => r.auto);
  const manual = rows.filter((r) => !r.auto);
  const definedBp = manual.reduce((sum, r) => sum + (r.bp ?? 0), 0);
  const remainingBp = WEIGHT_BP_MAX - definedBp;
  const manualMissing = manual.some((r) => r.bp === null || r.bp < 1 || r.bp > WEIGHT_BP_MAX);
  const resolve = (autoBp: number | null) =>
    rows.map((r) => ({ key: r.key, bp: r.auto ? autoBp : r.bp, auto: r.auto }));

  if (autos.length > 1 || manualMissing || rows.length === 0)
    return { rows: resolve(null), definedBp, remainingBp, status: 'INCOMPLETE' };
  if (definedBp > WEIGHT_BP_MAX)
    return { rows: resolve(null), definedBp, remainingBp, status: 'OVER_100' };
  if (autos.length === 1) {
    if (remainingBp < 1)
      return { rows: resolve(null), definedBp, remainingBp, status: 'AUTO_NO_ROOM' };
    return { rows: resolve(remainingBp), definedBp, remainingBp, status: 'COMPLETE' };
  }
  return {
    rows: resolve(null),
    definedBp,
    remainingBp,
    status: definedBp === WEIGHT_BP_MAX ? 'COMPLETE' : 'UNDER_100',
  };
}
