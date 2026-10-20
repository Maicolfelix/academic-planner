import type {
  Evaluation,
  GradingPeriod,
  GradingProfile,
  SubjectGradeSummaryDto,
} from '@planner/core';
import { describe, expect, it } from 'vitest';
import {
  accumulatedText,
  distributionFrom,
  distributionRequest,
  distributionShown,
  distributionSummary,
  editDistribution,
  setDistributionAuto,
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
  estimateText,
  contributionText,
  cutGradeMilli,
  cutsWithGrade,
  buildCutGrade,
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
  subjectId: U(3),
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
  isCutGrade: false,
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

  const typed = (...p: string[]) => p.map((percent, i) => ({ name: `Corte ${i + 1}`, percent }));
  const shares = (r: ReturnType<typeof buildCuts>) => r.cuts?.map((c) => c.finalShareBp);

  it('the cuts of a subject add up to EXACTLY 100 %: 30/30/40 is valid, 30/30/30 and 50/40/20 are not', () => {
    expect(shares(buildCuts(typed('30', '30', '40')))).toEqual([3000, 3000, 4000]);
    expect(buildCuts(typed('30', '30', '30')).errors?.[0]).toMatch(/suman 90 %.*exactamente 100 %/);
    expect(buildCuts(typed('50', '40', '20')).errors?.[0]).toMatch(/suman 110 %/);
    expect(shares(buildCuts(typed('100')))).toEqual([10_000]); // a single grade is a normal case
    expect(shares(buildCuts(typed('')))).toEqual([10_000]); // a lone blank cut is the whole grade
  });

  it('ONE blank percentage takes the rest of ITS subject: 30/30/blank → 40, 25/blank/40 → 35, blank/35/40 → 25', () => {
    expect(shares(buildCuts(typed('30', '30', '')))).toEqual([3000, 3000, 4000]);
    expect(shares(buildCuts(typed('25', '', '40')))).toEqual([2500, 3500, 4000]);
    expect(shares(buildCuts(typed('', '35', '40')))).toEqual([2500, 3500, 4000]);
    expect(shares(buildCuts(typed('50', '')))).toEqual([5000, 5000]);
  });

  it('never guesses: 30/blank/blank and blank/blank do not save', () => {
    expect(buildCuts(typed('30', '', '')).errors).toBeDefined();
    expect(buildCuts(typed('', '')).errors).toBeDefined();
    expect(buildCuts(typed('60', '40', '')).errors).toBeDefined(); // nothing left for the blank one
  });

  it('cuts must be named and weighted', () => {
    expect(buildCuts([{ name: '', percent: 'x' }]).errors).toHaveLength(2);
    expect(buildCuts([]).errors).toBeDefined();
    expect(
      buildCuts(
        rowsFromDrafts([
          { name: 'A', finalShareBp: 6000 },
          { name: 'B', finalShareBp: 4000 },
        ]),
      ).cuts,
    ).toHaveLength(2);
  });

  it('explains a locked scale in words', () => {
    expect(gradingErrorText('GRADING_SCALE_LOCKED', 'x')).toBe(
      'Ya hay notas registradas; la escala mínima y máxima ya no se pueden cambiar.',
    );
    expect(gradingErrorText('OTHER', 'tal cual')).toBe('tal cual');
  });
});

describe('what the summary says', () => {
  it('current grade (the average of what is registered), or the words when nothing is', () => {
    expect(currentText(summary(), 1)).toBe('3.5');
    expect(currentText(summary({ currentMilli: null, currentPasses: null }), 1)).toBe(
      'Sin notas todavía',
    );
  });

  it('the accumulated grade is not the average of what is registered', () => {
    const cuts = [cut(1, 3000), cut(2, 7000)];
    const evaluations = [ev(1, cuts[0]!.id, 10_000, 4500)]; // 4.5 on a cut worth 30 % of the final grade
    expect(accumulatedText(cuts, evaluations, 1)).toBe('1.4'); // 1.35 accumulated (half up), over the whole final grade
    expect(currentText(summary({ currentMilli: 4500 }), 1)).toBe('4.5'); // the average of what was graded
    expect(accumulatedText(cuts, [ev(1, cuts[0]!.id, 10_000, null)], 1)).toBe('Sin notas todavía');
  });

  it('NEEDED / SECURED / IMPOSSIBLE: the average the rest needs, over what remains, to reach the pass mark', () => {
    // 30/30/40 with only the second cut graded 4.5: (3.0 − 1.35) / 0.70 = 2.357… → 2.4 (rounded UP), over the 70 % that remains
    const example = summary({
      required: { status: 'NEEDED', requiredMilli: 2358 },
      remainingWeightUnits: 70_000_000,
    });
    expect(requiredView(example, 1, 3000)).toMatchObject({
      kind: 'NEEDED',
      estimate: false,
      text: 'Necesitas aproximadamente 2.4 de promedio en el 70 % restante para llegar a 3.0.',
    });
    expect(requiredView(summary({ required: { status: 'SECURED' } }), 1, 3000).text).toBe(
      'Con lo ya registrado, el objetivo está asegurado aunque el resto quede en el mínimo de la escala.',
    );
    expect(requiredView(summary({ required: { status: 'IMPOSSIBLE' } }), 1, 3000).text).toBe(
      'Con el peso restante no alcanza para llegar a la nota objetivo.',
    );
    expect(requiredView(summary({ complete: false }), 1, 3000).estimate).toBe(true);
  });
});

describe('an empty cut is not undefined weight', () => {
  const cuts = [cut(1, 3000), cut(2, 3000), cut(3, 4000)];
  const direct = (n: number, score: number) =>
    ev(n, cuts[n - 1]!.id, 10_000, score, { isCutGrade: true, name: `Nota de Corte ${n}` });

  it('30/30/40 with only the second cut graded: no estimate warning', () => {
    const groups = groupByCut(cuts, [direct(2, 4500)]);
    expect(estimateText({ complete: true }, groups, 'cortes')).toBeNull();
  });

  it('a cut described to less than 100 % names itself; cuts that do not add up say so', () => {
    const partial = groupByCut(cuts, [ev(1, cuts[1]!.id, 7000, 4000)]);
    expect(estimateText({ complete: false }, partial, 'cortes')).toBe(
      'Estimación: falta definir parte del peso de Corte 2.',
    );
    const short = groupByCut([cut(1, 3000), cut(2, 3000)], []);
    expect(estimateText({ complete: false }, short, 'cortes')).toBe(
      'Estimación: los cortes suman 60 %, falta definir el resto.',
    );
    expect(estimateText({ complete: false }, groupByCut(cuts, []), 'cortes')).toBe(
      'Estimación: faltan pesos por definir.',
    );
  });

  it('the grade of a cut, what it adds to the final grade and how many cuts have one', () => {
    const groups = groupByCut(cuts, [direct(2, 4500)]);
    expect(groups[1]!.direct?.scoreMilli).toBe(4500);
    expect(groups[1]!.detailed).toEqual([]);
    expect(cutGradeMilli(groups[1]!)).toBe(4500);
    expect(cutGradeMilli(groups[0]!)).toBeNull();
    expect(contributionText(groups[1]!, 1)).toBe('1.35'); // 4.5 × 30 %: one more digit than the scale, not the average of the cut
    expect(contributionText(groups[0]!, 1)).toBeNull();
    expect(cutsWithGrade(groups)).toBe(1);
  });

  it('a broken-down cut has a grade only when its subtotal is clear', () => {
    const groups = groupByCut(cuts, [
      ev(1, cuts[0]!.id, 5000, 4000),
      ev(2, cuts[0]!.id, 5000, 3000),
    ]);
    expect(cutGradeMilli(groups[0]!)).toBe(3500);
    expect(groups[0]!.direct).toBeNull();
    expect(groups[0]!.detailed).toHaveLength(2);
  });
});

describe('the grade of a whole cut (no name, no weight, no cut selector)', () => {
  const CUT = U(11);
  it('a note: only the subject, the cut and the grade', () => {
    const built = buildCutGrade(
      { mode: 'NOTE', note: '4,5', earned: '', max: '' },
      profile(),
      SUBJECT,
      CUT,
    );
    expect(built.create).toEqual({
      subjectId: SUBJECT,
      gradingPeriodId: CUT,
      isCutGrade: true,
      scoreMilli: 4500,
    });
    expect(built.create).not.toHaveProperty('name');
    expect(built.create).not.toHaveProperty('periodShareBp');
    expect(built.update).toEqual({ scoreMilli: 4500 });
  });
  it('the grade is required, and inside the scale', () => {
    expect(
      buildCutGrade({ mode: 'NOTE', note: '', earned: '', max: '' }, profile(), SUBJECT, CUT).errors
        ?.note,
    ).toBe('Escribe la nota del corte.');
    expect(
      buildCutGrade({ mode: 'NOTE', note: '9', earned: '', max: '' }, profile(), SUBJECT, CUT)
        .errors?.note,
    ).toMatch(/entre 0.0 y 5.0/);
  });
  it('18 of 20 on a scale that starts at 0 sends only the points (the server converts)', () => {
    const built = buildCutGrade(
      { mode: 'POINTS', note: '', earned: '18', max: '20' },
      profile(),
      SUBJECT,
      CUT,
    );
    expect(built.create).toMatchObject({ rawEarnedMilli: 18_000, rawMaxMilli: 20_000 });
    expect(built.create).not.toHaveProperty('scoreMilli');
  });
  it('on a scale that does not start at 0 the points need the grade too — nothing is guessed', () => {
    const p = profile({ minMilli: 1000, maxMilli: 7000, passMilli: 4000 });
    expect(
      buildCutGrade({ mode: 'POINTS', note: '', earned: '18', max: '20' }, p, SUBJECT, CUT).errors
        ?.note,
    ).toMatch(/nota ya convertida/);
  });
  it('editing with the points untouched keeps the stored grade; changing them lets the server recompute', () => {
    const original = ev(1, CUT, 10_000, 4333, {
      isCutGrade: true,
      rawEarnedMilli: 17_500,
      rawMaxMilli: 20_000,
    });
    const same = buildCutGrade(
      { mode: 'POINTS', note: '', earned: '17.5', max: '20' },
      profile(),
      SUBJECT,
      CUT,
      original,
    );
    expect(same.update).toMatchObject({ scoreMilli: 4333 });
    const changed = buildCutGrade(
      { mode: 'POINTS', note: '', earned: '19', max: '20' },
      profile(),
      SUBJECT,
      CUT,
      original,
    );
    expect(changed.update).not.toHaveProperty('scoreMilli');
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

describe('editing the distribution of the cuts (Editar distribución)', () => {
  const rowsOf = (...bps: number[]) =>
    distributionFrom(
      bps.map((finalShareBp, i) => ({
        id: `c${i + 1}`,
        name: `Corte ${i + 1}`,
        finalShareBp,
      })) as never,
    );
  const shown = (rows: ReturnType<typeof rowsOf>) => rows.map((r) => distributionShown(rows, r.id));

  it('starts 30 / 30 / 40 with the last cut automatic', () => {
    const rows = rowsOf(3000, 3000, 4000);
    expect(rows.map((r) => r.auto)).toEqual([false, false, true]);
    expect(shown(rows)).toEqual(['30', '30', '40']);
  });

  it('changing the first cut moves ONLY the automatic one: 40 → 30, 20 → 50', () => {
    let rows = editDistribution(rowsOf(3000, 3000, 4000), 'c1', '40');
    expect(shown(rows)).toEqual(['40', '30', '30']);
    rows = editDistribution(rows, 'c1', '20');
    expect(shown(rows)).toEqual(['20', '30', '50']);
    expect(distributionSummary(rows).canSave).toBe(true);
  });

  it('typing in the automatic cut makes it manual: nothing else changes behind the back', () => {
    const rows = editDistribution(rowsOf(3000, 3000, 4000), 'c3', '45');
    expect(rows.map((r) => r.auto)).toEqual([false, false, false]);
    expect(shown(rows)).toEqual(['30', '30', '45']);
    const s = distributionSummary(rows);
    expect(s.canSave).toBe(false);
    expect(s.messages.map((m) => m.text)).toContain('Te pasaste por 5 %.');
  });

  it('60 / 50 / auto never goes negative and cannot be saved', () => {
    const rows = editDistribution(
      editDistribution(rowsOf(3000, 3000, 4000), 'c1', '60'),
      'c2',
      '50',
    );
    expect(distributionShown(rows, 'c3')).toBe('');
    const s = distributionSummary(rows);
    expect(s.canSave).toBe(false);
    expect(s.messages.map((m) => m.text)).toEqual(
      expect.arrayContaining([
        'Total: 110 %',
        'Te pasaste por 10 %.',
        'Los cortes no pueden superar el 100 %.',
      ]),
    );
    expect(distributionRequest(rows)).toBeNull();
  });

  it('all manual 30 / 30 / 30: 10 % left, not placed anywhere, save disabled until one is automatic', () => {
    let rows = setDistributionAuto(rowsOf(3000, 3000, 4000), 'c3', false);
    rows = editDistribution(rows, 'c3', '30');
    const s = distributionSummary(rows);
    expect(s.remaining).toBe('10 %');
    expect(s.canSave).toBe(false);
    expect(s.messages.map((m) => m.text)).toContain('Falta distribuir 10 %.');
    const fixed = setDistributionAuto(rows, 'c2', true);
    expect(shown(fixed)).toEqual(['30', '40', '30']);
    expect(distributionSummary(fixed).canSave).toBe(true);
  });

  it('only ONE automatic cut at a time; the one it replaces keeps its figure', () => {
    const rows = setDistributionAuto(rowsOf(3000, 3000, 4000), 'c1', true);
    expect(rows.map((r) => r.auto)).toEqual([true, false, false]);
    expect(shown(rows)).toEqual(['30', '30', '40']);
  });

  it('emptying one cut with no automatic cut makes it the automatic one (one pass, no chain)', () => {
    let rows = setDistributionAuto(rowsOf(3000, 3000, 4000), 'c3', false);
    rows = editDistribution(rows, 'c1', '');
    expect(rows.map((r) => r.auto)).toEqual([true, false, false]);
    expect(shown(rows)).toEqual(['30', '30', '40']);
  });

  it('builds the exact request only when complete; a single 100 % grade is complete', () => {
    const rows = editDistribution(rowsOf(3000, 3000, 4000), 'c1', '40');
    expect(distributionRequest(rows)?.gradingPeriods.map((c) => c.finalShareBp)).toEqual([
      4000, 3000, 3000,
    ]);
    expect(distributionSummary(rowsOf(10000)).canSave).toBe(true);
  });
});
