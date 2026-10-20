import { z } from 'zod';
import {
  accumulatedMilli,
  summarizeSubjectGrade,
  type CutWeight,
  type GradeScale,
} from './gradingMath.js';

/**
 * GRADE CONTEXT for the Radar and the Progress (read-only, derived on every read, never stored).
 *
 * The Radar stays TEMPORAL: this only adds context to an activity that is linked to evaluations ("Parcial · Corte 1 · 12 % de la
 * nota final"); it never changes the order, the category or the explanation of an activity. The Progress keeps two separate ideas:
 * how many activities are done, and the academic grade of each subject; they are never merged into one percentage.
 * The API sends data (thousandths, units), never copy; the screens word it, without judgements.
 */

const count = z.number().int().nonnegative();

/**
 * The weight of an evaluation in the FINAL grade, in units (100 % = WEIGHT_UNIT_TOTAL = 10 000 × 10 000): the share of its cut
 * in the final grade × its share inside the cut. 30 % of the final grade × 40 % of the cut = 12 %. Integers all the way: no float,
 * no rounding; it is only formatted for display. A direct cut grade (100 % of its cut) weighs exactly what its cut weighs.
 */
export const effectiveFinalWeightUnits = (cutFinalShareBp: number, periodShareBp: number): number =>
  cutFinalShareBp * periodShareBp;

// ── Radar: the evaluations linked to an activity ───────────────────────────────────────────────────────────────────────────

export const gradeContextEvaluationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  cutName: z.string(),
  /** The grade of a whole cut (no name of its own). */
  isCutGrade: z.boolean(),
  /** null = not graded yet. */
  scoreMilli: z.number().int().nullable(),
  periodShareBp: count,
  cutFinalShareBp: count,
  /** Weight in the final grade, in units (see `effectiveFinalWeightUnits`). */
  finalWeightUnits: count,
});
export type GradeContextEvaluation = z.infer<typeof gradeContextEvaluationSchema>;

/** An activity may back 0..N evaluations: none is chosen over another, all are listed and their weights add up. */
export const gradeContextSchema = z.object({
  evaluations: z.array(gradeContextEvaluationSchema).min(1),
  totalFinalWeightUnits: count,
  /** The scale of the subject's period, to show a score (decimals: how many digits). */
  maxMilli: z.number().int(),
  decimals: z.number().int().min(0).max(3),
});
export type GradeContext = z.infer<typeof gradeContextSchema>;

export interface LinkedEvaluationRow {
  id: string;
  name: string;
  cutName: string;
  isCutGrade: boolean;
  scoreMilli: number | null;
  periodShareBp: number;
  cutFinalShareBp: number;
}

/** The context of an activity from the evaluations linked to it, or undefined when it has none (then nothing is shown at all). */
export function buildGradeContext(
  rows: readonly LinkedEvaluationRow[],
  scale: { maxMilli: number; decimals: number },
): GradeContext | undefined {
  if (rows.length === 0) return undefined;
  const evaluations = rows.map((r) => ({
    ...r,
    finalWeightUnits: effectiveFinalWeightUnits(r.cutFinalShareBp, r.periodShareBp),
  }));
  return {
    evaluations,
    totalFinalWeightUnits: evaluations.reduce((sum, e) => sum + e.finalWeightUnits, 0),
    maxMilli: scale.maxMilli,
    decimals: scale.decimals,
  };
}

// ── Progress: the academic grade of a subject ──────────────────────────────────────────────────────────────────────────────

export interface GradedItem {
  gradingPeriodId: string;
  periodShareBp: number;
  scoreMilli: number | null;
  isCutGrade: boolean;
}

/**
 * The grade of ONE cut, only when it can be said clearly: its direct grade, or the subtotal of its breakdown when the weights add
 * up to exactly 100 % and every evaluation is graded. Null while pending. (The grades screen words the same rule.)
 */
export function cutGradeMilli(
  items: readonly Pick<GradedItem, 'isCutGrade' | 'periodShareBp' | 'scoreMilli'>[],
): number | null {
  const direct = items.find((e) => e.isCutGrade);
  if (direct?.scoreMilli != null) return direct.scoreMilli;
  if (items.length === 0 || items.reduce((sum, e) => sum + e.periodShareBp, 0) !== 10_000)
    return null;
  let weighted = 0;
  for (const e of items) {
    if (e.scoreMilli === null) return null;
    weighted += e.scoreMilli * e.periodShareBp;
  }
  return Math.round(weighted / 10_000);
}

/** How many cuts have a grade ("1 de 3 cortes con nota"). */
export const countCutsWithGrade = (
  cuts: readonly CutWeight[],
  items: readonly GradedItem[],
): number =>
  cuts.filter((c) => cutGradeMilli(items.filter((i) => i.gradingPeriodId === c.id)) !== null)
    .length;

export const subjectGradeProgressSchema = z.object({
  /** What the graded evaluations already contribute to the FINAL grade (the rest counts as 0 for now); null while nothing is graded. */
  accumulatedMilli: z.number().int().nullable(),
  /** The average of what is graded (weighted); null while nothing is graded. */
  currentMilli: z.number().int().nullable(),
  /** The scale of the subject's period, to show "x / max" (decimals: how many to show). */
  maxMilli: z.number().int(),
  passMilli: z.number().int(),
  decimals: z.number().int().min(0).max(3),
  evaluatedWeightUnits: count,
  remainingWeightUnits: count,
  cutsWithGrade: count,
  cutsTotal: count,
  /** The split of the final grade is fully defined (otherwise every figure is an estimate). */
  complete: z.boolean(),
});
export type SubjectGradeProgress = z.infer<typeof subjectGradeProgressSchema>;

/**
 * The grade of a subject for the Progress, or null when there is nothing to show: no scale for its period, or no cuts yet (never a
 * made-up 0.0). The arithmetic is the one of the grades screen (`summarizeSubjectGrade`, `accumulatedMilli`).
 */
export function buildSubjectGradeProgress(
  scale: (GradeScale & { decimals: number }) | null,
  cuts: readonly CutWeight[],
  items: readonly GradedItem[],
): SubjectGradeProgress | null {
  if (!scale || cuts.length === 0) return null;
  const summary = summarizeSubjectGrade(scale, cuts, items);
  return {
    accumulatedMilli: accumulatedMilli(cuts, items),
    currentMilli: summary.currentMilli,
    maxMilli: scale.maxMilli,
    passMilli: scale.passMilli,
    decimals: scale.decimals,
    evaluatedWeightUnits: summary.evaluatedWeightUnits,
    remainingWeightUnits: summary.remainingWeightUnits,
    cutsWithGrade: countCutsWithGrade(cuts, items),
    cutsTotal: cuts.length,
    complete: summary.complete,
  };
}
