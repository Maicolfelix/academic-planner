import {
  GRADE_MILLI_MAX,
  accumulatedMilli,
  bpToPercentText,
  distributeWeights,
  cutContributionMilli,
  formatUnitsPercent,
  RAW_MILLI_MAX,
  formatNeeded,
  formatPercent,
  formatPoints,
  formatScore,
  percentToBp,
  pointsToMilli,
  withRemainder,
  scaleProblems,
  scoreToMilli,
  type CreateEvaluationInput,
  type CutDraft,
  type DistributionResult,
  type ReplaceCutWeightsInput,
  type Evaluation,
  type GradingPeriod,
  type GradingProfile,
  type SubjectGradeSummaryDto,
  type UpdateEvaluationInput,
} from '@planner/core';

/**
 * The pure side of the subject grades screen (B2): the words it says, the numbers it derives for display and the translation of
 * what a student types ("40", "4.2", "18" of "20") into the request. Nothing here knows React, and nothing shows or builds an
 * internal figure (milli, basis points): the conversions come from `@planner/core`.
 */

// ── What the summary says ───────────────────────────────────────────────────────────────────────────────────────────────

/** "3.4", or the words when nothing is graded yet. */
export const currentText = (s: SubjectGradeSummaryDto, decimals: number) =>
  s.currentMilli === null ? 'Sin notas todavía' : formatScore(s.currentMilli, decimals);

/** The accumulated grade ("lo que llevas en la materia"), or the words when nothing is graded yet. */
export function accumulatedText(
  cuts: readonly GradingPeriod[],
  evaluations: readonly Evaluation[],
  decimals: number,
): string {
  const milli = accumulatedMilli(cuts, evaluations);
  return milli === null ? 'Sin notas todavía' : formatScore(milli, decimals);
}

export interface RequiredView {
  kind: 'SECURED' | 'IMPOSSIBLE' | 'NEEDED';
  text: string;
  /** The split of the final grade is not fully defined: every figure is an estimate and the screen says so, always. */
  estimate: boolean;
}

export const ESTIMATE_TEXT = 'Estimación: faltan pesos por definir.';

/**
 * Why the figures are an estimate, in specific words — or null when they are not. A cut WITHOUT evaluations is not "undefined
 * weight" (its weight is defined, just pending); only a cut described to less than 100 % is, or cuts that do not add up to 100 %.
 */
export function estimateText(
  summary: Pick<SubjectGradeSummaryDto, 'complete'>,
  groups: readonly CutGroup[],
  termManyLower: string,
): string | null {
  if (summary.complete) return null;
  const partial = groups.filter((g) => g.evaluations.length > 0 && !g.weightsComplete);
  const cutsBp = groups.reduce((sum, g) => sum + g.cut.finalShareBp, 0);
  const reasons: string[] = [];
  if (partial.length > 0)
    reasons.push(`falta definir parte del peso de ${partial.map((g) => g.cut.name).join(', ')}`);
  if (cutsBp < 10_000)
    reasons.push(`los ${termManyLower} suman ${formatPercent(cutsBp)}, falta definir el resto`);
  return reasons.length > 0 ? `Estimación: ${reasons.join('; ')}.` : ESTIMATE_TEXT;
}

/** The "¿Cuánto necesito?" block, for the pass mark as the target. */
export function requiredView(
  s: SubjectGradeSummaryDto,
  decimals: number,
  passMilli: number,
): RequiredView {
  const estimate = !s.complete;
  switch (s.required.status) {
    case 'SECURED':
      return {
        kind: 'SECURED',
        estimate,
        text: 'Con lo ya registrado, el objetivo está asegurado aunque el resto quede en el mínimo de la escala.',
      };
    case 'IMPOSSIBLE':
      return {
        kind: 'IMPOSSIBLE',
        estimate,
        text: 'Con el peso restante no alcanza para llegar a la nota objetivo.',
      };
    case 'NEEDED':
      return {
        kind: 'NEEDED',
        estimate,
        text: `Necesitas aproximadamente ${formatNeeded(s.required.requiredMilli, decimals)} de promedio en el ${formatUnitsPercent(s.remainingWeightUnits)} restante para llegar a ${formatScore(passMilli, decimals)}.`,
      };
  }
}

// ── Cuts and their evaluations ──────────────────────────────────────────────────────────────────────────────────────────

export interface CutGroup {
  cut: GradingPeriod;
  evaluations: Evaluation[];
  /** The student's grade of the WHOLE cut (no breakdown), if there is one. */
  direct: Evaluation | null;
  /** The cut broken down into evaluations (empty when it is a direct grade or has nothing yet). */
  detailed: Evaluation[];
  /** The evaluations of this cut add up to 100 % (otherwise there is no honest subtotal). */
  weightsComplete: boolean;
}

export function groupByCut(
  cuts: readonly GradingPeriod[],
  evaluations: readonly Evaluation[],
): CutGroup[] {
  return cuts.map((cut) => {
    const own = evaluations.filter((e) => e.gradingPeriodId === cut.id);
    return {
      cut,
      evaluations: own,
      direct: own.find((e) => e.isCutGrade) ?? null,
      detailed: own.filter((e) => !e.isCutGrade),
      weightsComplete: own.reduce((sum, e) => sum + e.periodShareBp, 0) === 10_000,
    };
  });
}

/**
 * The subtotal of a cut, ONLY when it can be said clearly: the weights of its evaluations add up to 100 % and every one is
 * graded. It is computed on the screen, never stored, and rounded for display.
 */
export function cutSubtotalMilli(group: CutGroup): number | null {
  if (!group.weightsComplete || group.evaluations.length === 0) return null;
  let weighted = 0;
  for (const e of group.evaluations) {
    if (e.scoreMilli === null) return null;
    weighted += e.scoreMilli * e.periodShareBp;
  }
  return Math.round(weighted / 10_000);
}

export function cutSubtotal(group: CutGroup, decimals: number): string | null {
  const milli = cutSubtotalMilli(group);
  return milli === null ? null : formatScore(milli, decimals);
}

/** The grade of a cut, when it has one: the direct grade, or the clear subtotal of its breakdown. Null while pending. */
export const cutGradeMilli = (group: CutGroup): number | null =>
  group.direct?.scoreMilli ?? cutSubtotalMilli(group);

/** How many cuts have a grade ("1 de 3 cortes con nota"). */
export const cutsWithGrade = (groups: readonly CutGroup[]) =>
  groups.filter((g) => cutGradeMilli(g) !== null).length;

/** What the cut adds to the final grade ("Aporta a la definitiva: 1.35"): one more digit than the scale, never stored. */
export function contributionText(group: CutGroup, decimals: number): string | null {
  const grade = cutGradeMilli(group);
  return grade === null
    ? null
    : formatScore(cutContributionMilli(group.cut.finalShareBp, grade), Math.min(decimals + 1, 3));
}

// ── The direct grade of a cut ───────────────────────────────────────────────────────────────────────────────────────────

export interface CutGradeFormValues {
  mode: ScoreMode;
  note: string;
  earned: string;
  max: string;
}

export const emptyCutGradeForm = (): CutGradeFormValues => ({
  mode: 'NOTE',
  note: '',
  earned: '',
  max: '',
});

export function cutGradeFormFrom(e: Evaluation): CutGradeFormValues {
  const points = e.rawEarnedMilli !== null && e.rawMaxMilli !== null;
  return {
    mode: points ? 'POINTS' : 'NOTE',
    note: e.scoreMilli === null ? '' : String(e.scoreMilli / 1000),
    earned: points ? String(e.rawEarnedMilli! / 1000) : '',
    max: points ? String(e.rawMaxMilli! / 1000) : '',
  };
}

/**
 * The request for the grade of a whole cut. No name, no weight, no cut selector: the cut and the subject come from the screen. On a
 * scale that starts at 0 the points convert by themselves (unless they were not touched when editing); on another scale the grade
 * is asked too (never guessed).
 */
export function buildCutGrade(
  values: CutGradeFormValues,
  profile: GradingProfile,
  subjectId: string,
  gradingPeriodId: string,
  original?: Evaluation,
):
  | { create: CreateEvaluationInput; update: UpdateEvaluationInput; errors?: undefined }
  | { create?: undefined; update?: undefined; errors: FormErrors } {
  const errors: FormErrors = {};
  let scoreMilli: number | undefined;
  let rawEarnedMilli: number | null | undefined;
  let rawMaxMilli: number | null | undefined;
  const needsNote = values.mode === 'NOTE' || !pointsConvertAlone(profile);
  if (values.mode === 'POINTS') {
    const earned = pointsToMilli(values.earned);
    const max = pointsToMilli(values.max);
    if (earned === null) errors.earned = 'Escribe los puntos obtenidos.';
    if (max === null || max <= 0) errors.max = 'Escribe el máximo de puntos (mayor que 0).';
    if (earned !== null && max !== null && max > 0 && earned > max)
      errors.earned = 'Lo obtenido no puede superar el máximo.';
    if (earned !== null && earned > RAW_MILLI_MAX) errors.earned = 'Número demasiado grande.';
    if (!errors.earned && !errors.max) {
      rawEarnedMilli = earned;
      rawMaxMilli = max;
      if (
        pointsConvertAlone(profile) &&
        original?.scoreMilli != null &&
        original.rawEarnedMilli === earned &&
        original.rawMaxMilli === max
      )
        scoreMilli = original.scoreMilli;
    }
  } else {
    rawEarnedMilli = original ? null : undefined;
    rawMaxMilli = original ? null : undefined;
  }
  if (needsNote && !(values.mode === 'POINTS' && (errors.earned || errors.max))) {
    if (values.note.trim() === '')
      errors.note =
        values.mode === 'NOTE'
          ? 'Escribe la nota del corte.'
          : 'En esta escala escribe también la nota ya convertida.';
    else {
      const checked = checkScore(values.note, profile);
      if (checked.error) errors.note = checked.error;
      else scoreMilli = checked.milli;
    }
  }
  if (Object.keys(errors).length > 0) return { errors };
  const score = scoreMilli === undefined ? {} : { scoreMilli };
  const raw =
    rawEarnedMilli === undefined
      ? {}
      : { rawEarnedMilli, rawMaxMilli: rawMaxMilli as number | null };
  return {
    create: { subjectId, gradingPeriodId, isCutGrade: true, ...score, ...raw },
    update: { ...score, ...raw },
  };
}

/** "4.2" for a graded evaluation; null while pending. */
export const scoreText = (e: Pick<Evaluation, 'scoreMilli'>, decimals: number) =>
  e.scoreMilli === null ? null : formatScore(e.scoreMilli, decimals);

/** "18 / 20" when the student reported points; it never replaces the score. */
export const rawText = (e: Pick<Evaluation, 'rawEarnedMilli' | 'rawMaxMilli'>) =>
  e.rawEarnedMilli !== null && e.rawMaxMilli !== null
    ? formatPoints(e.rawEarnedMilli, e.rawMaxMilli)
    : null;

// ── The evaluation form ─────────────────────────────────────────────────────────────────────────────────────────────────

export type ScoreMode = 'NOTE' | 'POINTS';

export interface EvaluationFormValues {
  name: string;
  gradingPeriodId: string;
  /** "40" (percent of the cut). */
  weight: string;
  mode: ScoreMode;
  note: string;
  earned: string;
  max: string;
  /** '' = not linked. */
  activityId: string;
}

export const emptyEvaluationForm = (gradingPeriodId: string): EvaluationFormValues => ({
  name: '',
  gradingPeriodId,
  weight: '',
  mode: 'NOTE',
  note: '',
  earned: '',
  max: '',
  activityId: '',
});

export type FormErrors = Partial<Record<keyof EvaluationFormValues | 'form', string>>;

const trimmed = (s: string) => s.trim();

/**
 * The scale starts at 0 → points convert by themselves; otherwise the student gives the score too (a conversion on a scale that
 * does not start at 0 would be a guess, and the server refuses it).
 */
export const pointsConvertAlone = (profile: Pick<GradingProfile, 'minMilli'>) =>
  profile.minMilli === 0;

function checkScore(text: string, profile: GradingProfile): { milli?: number; error?: string } {
  const milli = scoreToMilli(text);
  const range = `${formatScore(profile.minMilli, profile.decimals)} y ${formatScore(profile.maxMilli, profile.decimals)}`;
  if (milli === null) return { error: `Escribe una nota entre ${range}.` };
  if (milli < profile.minMilli || milli > profile.maxMilli)
    return { error: `La nota debe estar entre ${range}.` };
  return { milli };
}

type Built<T> = { input: T; errors?: undefined } | { input?: undefined; errors: FormErrors };

/**
 * The request for creating (`create`) or updating an evaluation. Editing sends every field, with `null` where the student
 * emptied one, so a cleared note or points really clears.
 */
export function buildEvaluation(
  values: EvaluationFormValues,
  profile: GradingProfile,
  subjectId: string,
  mode: 'create',
): Built<CreateEvaluationInput>;
export function buildEvaluation(
  values: EvaluationFormValues,
  profile: GradingProfile,
  subjectId: string,
  mode: 'update',
  original?: Evaluation,
): Built<UpdateEvaluationInput>;
export function buildEvaluation(
  values: EvaluationFormValues,
  profile: GradingProfile,
  subjectId: string,
  mode: 'create' | 'update',
  original?: Evaluation,
): Built<CreateEvaluationInput> | Built<UpdateEvaluationInput> {
  const errors: FormErrors = {};
  const name = trimmed(values.name);
  if (!name) errors.name = 'Escribe el nombre de la evaluación.';

  const bp = percentToBp(values.weight);
  if (bp === null || bp < 1) errors.weight = 'Escribe un peso entre 0 y 100 %.';

  let scoreMilli: number | null | undefined;
  let rawEarnedMilli: number | null | undefined;
  let rawMaxMilli: number | null | undefined;
  const clearing = mode === 'update' ? null : undefined;

  if (values.mode === 'NOTE') {
    if (trimmed(values.note) === '') {
      scoreMilli = clearing;
    } else {
      const checked = checkScore(values.note, profile);
      if (checked.error) errors.note = checked.error;
      else scoreMilli = checked.milli;
    }
    rawEarnedMilli = clearing;
    rawMaxMilli = clearing;
  } else {
    const hasPoints = trimmed(values.earned) !== '' || trimmed(values.max) !== '';
    if (!hasPoints) {
      scoreMilli = clearing;
      rawEarnedMilli = clearing;
      rawMaxMilli = clearing;
    } else {
      const earned = pointsToMilli(values.earned);
      const max = pointsToMilli(values.max);
      if (earned === null) errors.earned = 'Escribe los puntos obtenidos.';
      if (max === null || max <= 0) errors.max = 'Escribe el máximo de puntos (mayor que 0).';
      if (earned !== null && max !== null && max > 0 && earned > max)
        errors.earned = 'Lo obtenido no puede superar el máximo.';
      if (earned !== null && earned > RAW_MILLI_MAX) errors.earned = 'Número demasiado grande.';
      if (!errors.earned && !errors.max) {
        rawEarnedMilli = earned;
        rawMaxMilli = max;
        if (!pointsConvertAlone(profile)) {
          // No guessing on a scale that does not start at 0: the student gives the score as well.
          if (trimmed(values.note) === '')
            errors.note = 'En esta escala escribe también la nota ya convertida.';
          else {
            const checked = checkScore(values.note, profile);
            if (checked.error) errors.note = checked.error;
            else scoreMilli = checked.milli;
          }
        }
        // A scale that starts at 0: scoreMilli stays absent and the server converts the points — unless the points were not
        // touched, in which case the stored score is kept as it is (it may have been given explicitly next to them).
        else if (
          original &&
          original.scoreMilli !== null &&
          original.rawEarnedMilli === earned &&
          original.rawMaxMilli === max
        )
          scoreMilli = original.scoreMilli;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  const base = {
    name,
    gradingPeriodId: values.gradingPeriodId,
    periodShareBp: bp as number,
    ...(scoreMilli !== undefined && { scoreMilli }),
    ...(rawEarnedMilli !== undefined && { rawEarnedMilli }),
    ...(rawMaxMilli !== undefined && { rawMaxMilli }),
  };
  if (mode === 'create')
    return {
      input: {
        ...base,
        subjectId,
        ...(values.activityId && { activityId: values.activityId }),
      },
    };
  return { input: { ...base, activityId: values.activityId === '' ? null : values.activityId } };
}

/** The form values of an existing evaluation (points mode when it has them). */
export function formFromEvaluation(e: Evaluation): EvaluationFormValues {
  const points = e.rawEarnedMilli !== null && e.rawMaxMilli !== null;
  return {
    name: e.name,
    gradingPeriodId: e.gradingPeriodId,
    weight: String(e.periodShareBp / 100),
    mode: points ? 'POINTS' : 'NOTE',
    // the EXACT figure (never the rounded one for display), so saving again cannot change the stored score
    note: e.scoreMilli === null ? '' : String(e.scoreMilli / 1000),
    earned: points ? String(e.rawEarnedMilli! / 1000) : '',
    max: points ? String(e.rawMaxMilli! / 1000) : '',
    activityId: e.activityId ?? '',
  };
}

/** The quick grade: only the score. */
export function buildQuickGrade(
  text: string,
  profile: GradingProfile,
): { scoreMilli: number; error?: undefined } | { error: string; scoreMilli?: undefined } {
  const checked = checkScore(text, profile);
  return checked.error ? { error: checked.error } : { scoreMilli: checked.milli! };
}

// ── The scale and the cuts ──────────────────────────────────────────────────────────────────────────────────────────────

export interface ScaleFormValues {
  min: string;
  max: string;
  pass: string;
  decimals: string;
}

export const scaleFormFrom = (p: GradingProfile): ScaleFormValues => ({
  min: String(p.minMilli / 1000),
  max: String(p.maxMilli / 1000),
  pass: String(p.passMilli / 1000),
  decimals: String(p.decimals),
});

export type ScaleErrors = Partial<Record<keyof ScaleFormValues, string>>;

export function buildScale(v: ScaleFormValues):
  | {
      profile: { minMilli: number; maxMilli: number; passMilli: number; decimals: number };
      errors?: undefined;
    }
  | { profile?: undefined; errors: ScaleErrors } {
  const errors: ScaleErrors = {};
  const min = scoreToMilli(v.min);
  const max = scoreToMilli(v.max);
  const pass = scoreToMilli(v.pass);
  const decimals = Number(v.decimals);
  if (min === null) errors.min = 'Escribe la nota mínima.';
  if (max === null) errors.max = 'Escribe la nota máxima.';
  if (pass === null) errors.pass = 'Escribe la nota para aprobar.';
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3)
    errors.decimals = 'Elige entre 0 y 3 decimales.';
  if (min !== null && max !== null && pass !== null) {
    if (max > GRADE_MILLI_MAX) errors.max = 'La nota máxima no puede pasar de 100.';
    const problems = scaleProblems({ minMilli: min, maxMilli: max, passMilli: pass });
    if (problems.maxMilli) errors.max = errors.max ?? problems.maxMilli;
    if (problems.passMilli) errors.pass = problems.passMilli;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    profile: { minMilli: min!, maxMilli: max!, passMilli: pass!, decimals },
  };
}

export interface CutRow {
  name: string;
  /** "30" (percent of the final grade). */
  percent: string;
}

export const rowsFromDrafts = (cuts: readonly CutDraft[]): CutRow[] =>
  cuts.map((c) => ({ name: c.name, percent: String(c.finalShareBp / 100) }));

/** Sum of the percentages typed, in basis points (ignoring the rows that are not numbers). */
export const rowsTotalBp = (rows: readonly CutRow[]) =>
  rows.reduce((sum, r) => sum + (percentToBp(r.percent) ?? 0), 0);

/**
 * The cuts of ONE subject as typed. ONE blank percentage takes the rest (30 / 30 / blank → 40; 25 / blank / 40 → 35); two or more
 * blanks are never guessed. The result must add up to EXACTLY 100 %.
 */
export function buildCuts(
  typed: readonly CutRow[],
): { cuts: CutDraft[]; errors?: undefined } | { cuts?: undefined; errors: string[] } {
  const rows = withRemainder(typed);
  const errors: string[] = [];
  if (rows.length === 0) errors.push('Agrega al menos un corte.');
  const cuts: CutDraft[] = [];
  rows.forEach((r, i) => {
    const name = r.name.trim();
    const bp = percentToBp(r.percent);
    if (!name) errors.push(`Escribe el nombre del corte ${i + 1}.`);
    if (bp === null || bp < 1)
      errors.push(`Escribe un peso entre 0 y 100 % para el corte ${i + 1}.`);
    if (name && bp !== null && bp >= 1) cuts.push({ name, finalShareBp: bp });
  });
  if (errors.length === 0 && rowsTotalBp(rows) !== 10_000)
    errors.push(
      `Los cortes suman ${formatPercent(rowsTotalBp(rows))}: deben sumar exactamente 100 %.`,
    );
  return errors.length > 0 ? { errors } : { cuts };
}

/** The server's reason, in words, for the codes this screen can meet. */
export function gradingErrorText(code: string, message: string): string {
  if (code === 'GRADING_SCALE_LOCKED')
    return 'Ya hay notas registradas; la escala mínima y máxima ya no se pueden cambiar.';
  if (code === 'GRADING_PERIOD_NOT_EMPTY')
    return 'Este corte todavía tiene evaluaciones. Muévelas o elimínalas primero.';
  if (code === 'PERIOD_NOT_TRACKED')
    return 'Las notas necesitan un periodo que pertenezca a un estudio.';
  return message;
}

/** The server's per-field reasons (a sum over 100 %, a score out of range…) mapped to the evaluation form's own fields. */
export function evaluationServerErrors(fields: Record<string, string[]>): FormErrors | null {
  const out: FormErrors = {};
  if (fields.periodShareBp) out.weight = fields.periodShareBp[0];
  if (fields.scoreMilli) out.note = fields.scoreMilli[0];
  if (fields.gradingPeriodId) out.gradingPeriodId = fields.gradingPeriodId[0];
  if (fields.activityId) out.activityId = fields.activityId[0];
  if (fields.name) out.name = fields.name[0];
  return Object.keys(out).length > 0 ? out : null;
}

// ── Editing how the final grade is split (the joint "Editar distribución") ─────────────────────────────────────────────────

/** One cut as typed. `auto`: the ONE cut that takes whatever the others leave (its `percent` is ignored). */
export interface DistRow {
  id: string;
  name: string;
  percent: string;
  auto: boolean;
}

/** The current weights, the LAST cut automatic (a student who changes one cut sees the last one absorb the difference). */
export const distributionFrom = (cuts: readonly GradingPeriod[]): DistRow[] =>
  cuts.map((c, i) => ({
    id: c.id,
    name: c.name,
    percent: bpToPercentText(c.finalShareBp),
    auto: cuts.length > 1 && i === cuts.length - 1,
  }));

export const evaluateDistribution = (rows: readonly DistRow[]): DistributionResult =>
  distributeWeights(rows.map((r) => ({ key: r.id, bp: percentToBp(r.percent), auto: r.auto })));

/** What the field of a row shows: its typed text, or the figure the automatic cut takes. */
export function distributionShown(rows: readonly DistRow[], id: string): string {
  const row = rows.find((r) => r.id === id);
  if (!row) return '';
  if (!row.auto) return row.percent;
  const bp = evaluateDistribution(rows).rows.find((r) => r.key === id)?.bp;
  return bp == null ? '' : bpToPercentText(bp);
}

/**
 * The student types in a cut. That cut stops being automatic (nothing else is moved behind their back); if that leaves exactly ONE
 * empty cut and no automatic one, the empty one becomes the automatic cut. One pass: no field ever changes another in a chain.
 */
export function editDistribution(rows: readonly DistRow[], id: string, text: string): DistRow[] {
  const next = rows.map((r) => (r.id === id ? { ...r, percent: text, auto: false } : r));
  if (next.some((r) => r.auto)) return next;
  const empty = next.filter((r) => r.percent.trim() === '');
  return empty.length === 1 ? next.map((r) => (r === empty[0] ? { ...r, auto: true } : r)) : next;
}

/** "Completar automáticamente": that cut takes the rest (any other automatic cut becomes manual, keeping its figure). */
export function setDistributionAuto(rows: readonly DistRow[], id: string, on: boolean): DistRow[] {
  const shown = (r: DistRow) => distributionShown(rows, r.id);
  return rows.map((r) =>
    r.id === id
      ? on
        ? { ...r, auto: true }
        : { ...r, auto: false, percent: shown(r) }
      : on && r.auto
        ? { ...r, auto: false, percent: shown(r) }
        : r,
  );
}

export interface DistributionMessage {
  tone: 'ok' | 'warn';
  text: string;
}

/** What to say under the cuts: always the total defined and what is left, and whether it can be saved. */
export function distributionSummary(rows: readonly DistRow[]): {
  defined: string;
  remaining: string;
  messages: DistributionMessage[];
  canSave: boolean;
} {
  const r = evaluateDistribution(rows);
  const defined = formatPercent(r.definedBp);
  const remaining = formatPercent(Math.max(r.remainingBp, 0));
  const messages: DistributionMessage[] = [];
  switch (r.status) {
    case 'COMPLETE':
      messages.push(
        { tone: 'ok', text: 'Total: 100 %' },
        { tone: 'ok', text: '✓ Distribución completa' },
      );
      break;
    case 'OVER_100':
      messages.push(
        { tone: 'warn', text: `Total: ${defined}` },
        { tone: 'warn', text: `Te pasaste por ${formatPercent(r.definedBp - 10_000)}.` },
        { tone: 'warn', text: 'Los cortes no pueden superar el 100 %.' },
      );
      break;
    case 'UNDER_100':
      messages.push(
        { tone: 'warn', text: `Total: ${defined}` },
        { tone: 'warn', text: `Falta distribuir ${remaining}.` },
        { tone: 'warn', text: 'Cambia un corte o márcalo como «Completar automáticamente».' },
      );
      break;
    case 'AUTO_NO_ROOM':
      messages.push({
        tone: 'warn',
        text: 'Los demás cortes ya suman 100 %: no queda nada para el corte automático.',
      });
      break;
    default:
      messages.push({ tone: 'warn', text: 'Escribe un porcentaje válido en cada corte.' });
  }
  return { defined, remaining, messages, canSave: r.status === 'COMPLETE' };
}

/** The request, only while the distribution is complete (the server checks it all again). */
export function distributionRequest(rows: readonly DistRow[]): ReplaceCutWeightsInput | null {
  const r = evaluateDistribution(rows);
  if (r.status !== 'COMPLETE') return null;
  return {
    gradingPeriods: r.rows.map((x) => ({ id: x.key, finalShareBp: x.bp as number })),
  };
}
