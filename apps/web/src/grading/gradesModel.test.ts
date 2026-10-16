import type {
  Evaluation,
  GradingPeriod,
  GradingProfile,
  SubjectGradeSummaryDto,
} from '@planner/core';
import { describe, expect, it } from 'vitest';
import {
  accumulatedText,
  buildCuts,
  buildEvaluation,
  buildQuickGrade,
  buildScale,
  currentText,
  cutSubtotal,
  emptyEvaluationForm,
  evaluationServerErrors,
  formFromEvaluation,
  gradingErrorText,
  groupByCut,
  rawText,
  requiredView,
  rowsFromDrafts,
  scoreText,
  statusText,
  type EvaluationFormValues,
} from './gradesModel';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = '2026-10-01T00:00:00.000Z';
const profile = (over: Partial<GradingProfile> = {}): GradingProfile => ({
  id: U(1),
  periodId: U(2),
  minMilli: 0,
  maxMilli: 5000,
  passMilli: 3000,
  decimals: 1,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const cut = (n: number, bp: number): GradingPeriod => ({
  id: U(10 + n),
  periodId: U(2),
  name: `Corte ${n}`,
  position: n,
  finalShareBp: bp,
  createdAt: iso,
  updatedAt: iso,
});
const ev = (
  n: number,
  cutId: string,
  bp: number,
  score: number | null,
  over: Partial<Evaluation> = {},
): Evaluation => ({
  id: U(100 + n),
  periodId: U(2),
  subjectId: U(3),
  gradingPeriodId: cutId,
  activityId: null,
  name: `E${n}`,
  periodShareBp: bp,
  scoreMilli: score,
  rawEarnedMilli: null,
  rawMaxMilli: null,
  scoredAt: null,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const summary = (over: Partial<SubjectGradeSummaryDto> = {}): SubjectGradeSummaryDto => ({
  complete: true,
  definedWeightUnits: 100_000_000,
  undefinedWeightUnits: 0,
  evaluatedWeightUnits: 60_000_000,
  remainingWeightUnits: 40_000_000,
  currentMilli: 3500,
  currentPasses: true,
  required: { status: 'NEEDED', requiredMilli: 2250 },
  ...over,
});
const form = (over: Partial<EvaluationFormValues> = {}): EvaluationFormValues => ({
  ...emptyEvaluationForm(U(11)),
  name: 'Parcial',
  weight: '40',
  ...over,
});
const SUBJECT = U(3);

describe('the evaluation form → request', () => {
  it('a pending evaluation: name, cut and weight; no score keys on create', () => {
    const built = buildEvaluation(form(), profile(), SUBJECT, 'create');
    expect(built.input).toEqual({
      name: 'Parcial',
      gradingPeriodId: U(11),
      periodShareBp: 4000,
      subjectId: SUBJECT,
    });
  });

  it('a score of 4.2 becomes the canonical figure; the subject comes from the page', () => {
    const built = buildEvaluation(form({ note: '4,2' }), profile(), SUBJECT, 'create');
    expect(built.input).toMatchObject({
      scoreMilli: 4200,
      subjectId: SUBJECT,
      periodShareBp: 4000,
    });
  });

  it('18 of 20 on a scale that starts at 0 sends only the points (the server converts)', () => {
    const built = buildEvaluation(
      form({ mode: 'POINTS', earned: '18', max: '20' }),
      profile(),
      SUBJECT,
      'create',
    );
    expect(built.input).toMatchObject({ rawEarnedMilli: 18_000, rawMaxMilli: 20_000 });
    expect(built.input).not.toHaveProperty('scoreMilli');
  });

  it('on a scale that does not start at 0 the points need the score too — nothing is guessed', () => {
    const p = profile({ minMilli: 1000, maxMilli: 7000, passMilli: 4000 });
    const missing = buildEvaluation(
      form({ mode: 'POINTS', earned: '18', max: '20' }),
      p,
      SUBJECT,
      'create',
    );
    expect(missing.errors?.note).toMatch(/nota ya convertida/);
    const given = buildEvaluation(
      form({ mode: 'POINTS', earned: '18', max: '20', note: '6.5' }),
      p,
      SUBJECT,
      'create',
    );
    expect(given.input).toMatchObject({
      scoreMilli: 6500,
      rawEarnedMilli: 18_000,
      rawMaxMilli: 20_000,
    });
  });

  it('says what is wrong in words, per field', () => {
    const built = buildEvaluation(
      form({ name: ' ', weight: '150', note: '9' }),
      profile(),
      SUBJECT,
      'create',
    );
    expect(Object.keys(built.errors!).sort()).toEqual(['name', 'note', 'weight']);
    expect(built.errors!.note).toBe('La nota debe estar entre 0.0 y 5.0.');
    const points = buildEvaluation(
      form({ mode: 'POINTS', earned: '21', max: '20' }),
      profile(),
      SUBJECT,
      'create',
    );
    expect(points.errors!.earned).toMatch(/no puede superar/);
  });

  it('editing sends every field and null where the student emptied one (a cleared note really clears)', () => {
    const built = buildEvaluation(
      form({ gradingPeriodId: U(12), weight: '25' }),
      profile(),
      SUBJECT,
      'update',
    );
    expect(built.input).toEqual({
      name: 'Parcial',
      gradingPeriodId: U(12), // moving to another cut
      periodShareBp: 2500, // editing the weight
      activityId: null,
      scoreMilli: null,
      rawEarnedMilli: null,
      rawMaxMilli: null,
    });
  });

  it('switching an evaluation from points to a plain note clears the points', () => {
    const built = buildEvaluation(form({ mode: 'NOTE', note: '4' }), profile(), SUBJECT, 'update');
    expect(built.input).toMatchObject({
      scoreMilli: 4000,
      rawEarnedMilli: null,
      rawMaxMilli: null,
    });
  });

  it('loads an existing evaluation with its EXACT figures, so saving again changes nothing', () => {
    const e = ev(1, U(11), 2500, 4333, { rawEarnedMilli: 17_500, rawMaxMilli: 20_000 });
    const values = formFromEvaluation(e);
    expect(values).toMatchObject({
      weight: '25',
      mode: 'POINTS',
      note: '4.333',
      earned: '17.5',
      max: '20',
    });
    expect(buildEvaluation(values, profile(), SUBJECT, 'update', e).input).toMatchObject({
      scoreMilli: 4333,
      periodShareBp: 2500,
      rawEarnedMilli: 17_500,
      rawMaxMilli: 20_000,
    });
  });

  it('changing the points of a zero-based evaluation lets the server recompute the score (never the old one)', () => {
    const e = ev(1, U(11), 2500, 4333, { rawEarnedMilli: 17_500, rawMaxMilli: 20_000 });
    const values = { ...formFromEvaluation(e), earned: '19' };
    const built = buildEvaluation(values, profile(), SUBJECT, 'update', e);
    expect(built.input).toMatchObject({ rawEarnedMilli: 19_000, rawMaxMilli: 20_000 });
    expect(built.input).not.toHaveProperty('scoreMilli');
  });

  it('maps a server answer over 100 % to the weight field (inline, not a toast)', () => {
    const message = 'Las evaluaciones de este corte no pueden sumar más de 100 %.';
    expect(evaluationServerErrors({ periodShareBp: [message] })).toEqual({ weight: message });
    expect(evaluationServerErrors({})).toBeNull();
  });
});

describe('quick grade', () => {
  it('only a score inside the scale', () => {
    expect(buildQuickGrade('4.2', profile())).toEqual({ scoreMilli: 4200 });
    expect(buildQuickGrade('5.1', profile()).error).toMatch(/entre 0.0 y 5.0/);
    expect(buildQuickGrade('', profile()).error).toBeDefined();
  });
});

describe('the scale and the cuts', () => {
  it('a custom scale is read in human numbers', () => {
    expect(buildScale({ min: '1', max: '7', pass: '4', decimals: '1' }).profile).toEqual({
      minMilli: 1000,
      maxMilli: 7000,
      passMilli: 4000,
      decimals: 1,
    });
    expect(buildScale({ min: '5', max: '1', pass: '3', decimals: '1' }).errors?.max).toBeDefined();
    expect(buildScale({ min: '0', max: '5', pass: '9', decimals: '1' }).errors?.pass).toBeDefined();
    expect(
      buildScale({ min: '0', max: '5', pass: '3', decimals: '7' }).errors?.decimals,
    ).toBeDefined();
    expect(buildScale({ min: 'a', max: '5', pass: '3', decimals: '1' }).errors?.min).toBeDefined();
  });

  it('custom cuts must be named, weighted and not pass 100 %; under 100 % is allowed', () => {
    const rows = rowsFromDrafts([
      { name: 'A', finalShareBp: 6000 },
      { name: 'B', finalShareBp: 4000 },
    ]);
    expect(buildCuts(rows).cuts).toHaveLength(2);
    expect(buildCuts([{ name: 'A', percent: '60' }]).cuts).toEqual([
      { name: 'A', finalShareBp: 6000 },
    ]);
    expect(
      buildCuts([
        { name: 'A', percent: '70' },
        { name: 'B', percent: '40' },
      ]).errors?.[0],
    ).toMatch(/110 %/);
    expect(buildCuts([{ name: '', percent: 'x' }]).errors).toHaveLength(2);
    expect(buildCuts([]).errors).toBeDefined();
  });

  it('explains a locked scale in words', () => {
    expect(gradingErrorText('GRADING_SCALE_LOCKED', 'x')).toBe(
      'Ya hay notas registradas; la escala mínima y máxima ya no se pueden cambiar.',
    );
    expect(gradingErrorText('OTHER', 'tal cual')).toBe('tal cual');
  });
});

describe('what the summary says', () => {
  it('current grade and neutral status', () => {
    expect(currentText(summary(), 1)).toBe('3.5');
    expect(currentText(summary({ currentMilli: null, currentPasses: null }), 1)).toBe(
      'Sin notas todavía',
    );
    expect(statusText(summary())).toBe(
      'Lo evaluado hasta ahora está por encima de la nota mínima.',
    );
    expect(statusText(summary({ currentPasses: false }))).toBe(
      'Lo evaluado hasta ahora está por debajo de la nota mínima.',
    );
    expect(statusText(summary({ currentPasses: null }))).toBeNull();
    expect(statusText(summary({ currentPasses: false }))).not.toMatch(/mal|perdiendo|riesgo/i);
  });

  it('the accumulated grade is not the average of the evaluated part', () => {
    const cuts = [cut(1, 3000), cut(2, 7000)];
    const evaluations = [ev(1, cuts[0]!.id, 10_000, 4500)]; // 4.5 on a cut worth 30 % of the final grade
    expect(accumulatedText(cuts, evaluations, 1)).toBe('1.4'); // 1.35 accumulated (half up), over the whole final grade
    expect(currentText(summary({ currentMilli: 4500 }), 1)).toBe('4.5'); // the average of what was graded
    expect(accumulatedText(cuts, [ev(1, cuts[0]!.id, 10_000, null)], 1)).toBe('Sin notas todavía');
    expect(statusText(summary())).not.toMatch(/materia|general/i); // it speaks only about what was evaluated
  });

  it('NEEDED / SECURED / IMPOSSIBLE and the estimate flag', () => {
    expect(requiredView(summary(), 1)).toMatchObject({
      kind: 'NEEDED',
      estimate: false,
      text: 'Necesitas aproximadamente 2.3 en lo que falta.',
    });
    expect(requiredView(summary({ required: { status: 'SECURED' } }), 1).text).toBe(
      'Con lo ya registrado, el objetivo está asegurado aunque el resto quede en el mínimo de la escala.',
    );
    expect(requiredView(summary({ required: { status: 'IMPOSSIBLE' } }), 1).text).toBe(
      'Con el peso restante no alcanza para llegar a la nota objetivo.',
    );
    expect(requiredView(summary({ complete: false }), 1).estimate).toBe(true);
  });
});

describe('cuts and rows', () => {
  const cuts = [cut(1, 3000), cut(2, 7000)];

  it('groups evaluations by cut and only gives a subtotal when it is clear', () => {
    const groups = groupByCut(cuts, [
      ev(1, cuts[0]!.id, 5000, 4000),
      ev(2, cuts[0]!.id, 5000, 3000),
      ev(3, cuts[1]!.id, 5000, null),
    ]);
    expect(groups[0]!.evaluations).toHaveLength(2);
    expect(cutSubtotal(groups[0]!, 1)).toBe('3.5');
    expect(cutSubtotal(groups[1]!, 1)).toBeNull(); // weights add up to 50 % and one is pending
  });

  it('shows the score with the profile decimals and the points apart from it', () => {
    const e = ev(1, cuts[0]!.id, 5000, 4500, { rawEarnedMilli: 18_000, rawMaxMilli: 20_000 });
    expect(scoreText(e, 1)).toBe('4.5');
    expect(rawText(e)).toBe('18 / 20');
    expect(scoreText(ev(2, cuts[0]!.id, 100, null), 1)).toBeNull();
    expect(rawText(ev(2, cuts[0]!.id, 100, null))).toBeNull();
  });
});
