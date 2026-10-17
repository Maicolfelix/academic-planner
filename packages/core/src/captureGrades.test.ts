import { describe, expect, it } from 'vitest';
import {
  interpretGrades,
  mergeGradeCapture,
  resolveGrade,
  weightToShareBp,
  type GradeCaptureContext,
  type GradeEvaluationCtx,
  type GradeProfileCtx,
  type GradeSubjectCtx,
  type GradeSuggestion,
} from './captureGrades.js';
import type { CaptureResult } from './captureProposals.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SCALE05: GradeProfileCtx = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
const SCALE17: GradeProfileCtx = { minMilli: 1000, maxMilli: 7000, passMilli: 4000, decimals: 1 };

let seq = 100;
function cuts(prefix: string, names: string[], shares: number[]) {
  return names.map((name, i) => ({
    id: U(++seq),
    name,
    position: i + 1,
    finalShareBp: shares[i]!,
  }));
}
function subject(
  id: number,
  name: string,
  over: Partial<GradeSubjectCtx> & { cutNames?: string[]; shares?: number[] } = {},
): GradeSubjectCtx {
  const {
    cutNames = ['Corte 1', 'Corte 2', 'Corte 3'],
    shares = [3000, 3000, 4000],
    ...rest
  } = over;
  return {
    id: U(id),
    name,
    periodId: U(900),
    studyName: 'Medicina',
    studyType: 'UNIVERSITY',
    isHome: true,
    profile: SCALE05,
    cuts: cuts(name, cutNames, shares),
    evaluations: [],
    ...rest,
  };
}
const pendingEval = (
  id: number,
  name: string,
  cutId: string,
  extra: Partial<GradeEvaluationCtx> = {},
): GradeEvaluationCtx => ({
  id: U(id),
  name,
  gradingPeriodId: cutId,
  activityTitle: null,
  scoreMilli: null,
  isCutGrade: false,
  ...extra,
});

const farma = subject(1, 'Farmacología');
const anatomiaBase = subject(2, 'Anatomía', {
  cutNames: ['Corte 1', 'Corte 2'],
  shares: [5000, 5000],
});
const anatomia = {
  ...anatomiaBase,
  evaluations: [pendingEval(50, 'Parcial', anatomiaBase.cuts[0]!.id)],
};
const bioBase = subject(3, 'Bioquímica');
const bio = { ...bioBase, evaluations: [pendingEval(51, 'Parcial', bioBase.cuts[0]!.id)] };
const mates = subject(4, 'Matemáticas');
const matesOffset = subject(5, 'Cálculo', { profile: SCALE17 });
const ctx = (...subjects: GradeSubjectCtx[]): GradeCaptureContext => ({ subjects });
const first = (text: string, c: GradeCaptureContext) => interpretGrades(text, c).suggestions[0]!;
const resolved = (s: GradeSuggestion, sel = {}) => resolveGrade(s, sel);

describe('direct cut grade — "Saqué 4.3 en el Corte 2 de Farmacología"', () => {
  const s = first('Saqué 4.3 en el Corte 2 de Farmacología', ctx(farma, anatomia));
  it('resolves the subject and the cut OF THAT SUBJECT and is ready: one confirmation', () => {
    expect(s.status).toBe('READY');
    expect(s.selected).toBe(true);
    const r = resolved(s);
    expect(r.option?.subject.name).toBe('Farmacología');
    expect(r.request).toEqual({
      action: 'SET_CUT_GRADE',
      subjectId: farma.id,
      gradingPeriodId: farma.cuts[1]!.id,
      scoreMilli: 4300,
    });
  });
  it('asks for no name, no weight and no activity', () => {
    expect(JSON.stringify(resolved(s).request)).not.toMatch(/name|periodShareBp|activity/);
  });
  it('the whole sentence is spoken for: nothing of it reaches the activity engine', () => {
    const { maskedText } = interpretGrades('Saqué 4.3 en el Corte 2 de Farmacología', ctx(farma));
    expect(maskedText.trim()).toBe('');
  });
  it('an existing direct grade of that cut becomes an UPDATE, never a duplicate', () => {
    const withDirect: GradeSubjectCtx = {
      ...farma,
      evaluations: [
        pendingEval(60, 'Nota de Corte 2', farma.cuts[1]!.id, {
          isCutGrade: true,
          scoreMilli: 3800,
        }),
      ],
    };
    const r = resolved(first('Saqué 4.3 en el Corte 2 de Farmacología', ctx(withDirect)));
    expect(r.request).toMatchObject({
      action: 'UPDATE_CUT_GRADE',
      evaluationId: U(60),
      expectScoreMilli: 3800,
      scoreMilli: 4300,
    });
  });
});

describe('ordinal and terminology references', () => {
  it('"segundo corte" and "primer corte" resolve by position', () => {
    expect(
      resolved(first('Saqué 3.9 en el segundo corte de Farmacología', ctx(farma))).request,
    ).toMatchObject({ gradingPeriodId: farma.cuts[1]!.id });
    expect(
      resolved(first('Nota 4.0 en el primer corte de Farmacología', ctx(farma))).request,
    ).toMatchObject({ gradingPeriodId: farma.cuts[0]!.id });
  });
  it('a school uses "periodo de evaluación"; an other study uses "etapa"; the wrong word is not a reference', () => {
    const school = subject(6, 'Matemáticas', {
      studyType: 'SCHOOL',
      studyName: 'Colegio',
      cutNames: ['Periodo 1', 'Periodo 2', 'Periodo 3', 'Periodo 4'],
      shares: [2500, 2500, 2500, 2500],
    });
    expect(
      resolved(first('Saqué 4.1 en el periodo de evaluación 2 de Matemáticas', ctx(school)))
        .request,
    ).toMatchObject({ gradingPeriodId: school.cuts[1]!.id });
    expect(
      resolved(first('Saqué 4.1 en el periodo 3 de Matemáticas', ctx(school))).request,
    ).toMatchObject({ gradingPeriodId: school.cuts[2]!.id });
    const other = subject(7, 'Módulo', {
      studyType: 'OTHER_ACADEMIC',
      studyName: 'Diplomado',
      cutNames: ['Etapa 1', 'Etapa 2'],
      shares: [5000, 5000],
    });
    expect(resolved(first('Saqué 4.5 en la etapa 1 del Módulo', ctx(other))).request).toMatchObject(
      { gradingPeriodId: other.cuts[0]!.id },
    );
    // "corte" in a school: not its word, and no cut has that name -> the student chooses
    const wrong = first('Saqué 4.1 en el corte 2 de Matemáticas', ctx(school));
    expect(wrong.status).toBe('NEEDS_REVIEW');
    expect(resolved(wrong).missing).toContain('TARGET');
  });
  it('the name and the number disagreeing is a question', () => {
    const odd = subject(8, 'Redes', {
      cutNames: ['Corte 2', 'Corte 1', 'Corte 3'],
      shares: [3000, 3000, 4000],
    });
    const s = first('Saqué 4.0 en el Corte 2 de Redes', ctx(odd));
    expect(s.status).toBe('NEEDS_REVIEW'); // "Corte 2" is the name of position 1, but position 2 is "Corte 1"
  });
});

describe('score update — "Saqué 4.2 en el parcial de Anatomía"', () => {
  it('matches the ONE pending evaluation of the resolved subject by exact name', () => {
    const s = first('Saqué 4.2 en el parcial de Anatomía', ctx(farma, anatomia, bio));
    expect(s.status).toBe('READY');
    expect(resolved(s).request).toEqual({
      action: 'SCORE_EVALUATION',
      subjectId: anatomia.id,
      evaluationId: U(50),
      expectScoreMilli: null,
      scoreMilli: 4200,
    });
  });
  it('also by the exact title of the linked activity', () => {
    const linked = {
      ...anatomia,
      evaluations: [
        pendingEval(52, 'Evaluación A', anatomia.cuts[0]!.id, { activityTitle: 'Parcial' }),
      ],
    };
    expect(
      resolved(first('Saqué 4.2 en el parcial de Anatomía', ctx(linked))).request,
    ).toMatchObject({ evaluationId: U(52) });
  });
  it('several matches -> review with candidates; none -> never a silent duplicate, the student is asked', () => {
    const two = {
      ...anatomia,
      evaluations: [
        pendingEval(53, 'Parcial', anatomia.cuts[0]!.id),
        pendingEval(54, 'Parcial', anatomia.cuts[1]!.id),
      ],
    };
    const multiple = first('Saqué 4.2 en el parcial de Anatomía', ctx(two));
    expect(multiple.status).toBe('NEEDS_REVIEW');
    expect(multiple.options[0]!.choices).toHaveLength(2);
    expect(multiple.options[0]!.auto).toBeNull();
    const none = first('Saqué 4.2 en el taller de Anatomía', ctx(anatomia));
    expect(none.status).toBe('NEEDS_REVIEW');
    expect(
      none.options[0]!.choices.map((c) =>
        c.action === 'SCORE_EVALUATION' ? c.evaluation.name : '',
      ),
    ).toEqual(['Parcial']);
    expect(resolved(none).request).toBeNull();
    // no pending evaluation at all: nothing to offer, nothing created
    const empty = first('Saqué 4.2 en el parcial de Farmacología', ctx(farma));
    expect(empty.options[0]!.notice).toBe('NO_PENDING_EVALUATIONS');
    expect(resolved(empty).request).toBeNull();
  });
  it('an already-graded evaluation is not a candidate (a newer score is never overwritten silently)', () => {
    const done = {
      ...anatomia,
      evaluations: [pendingEval(55, 'Parcial', anatomia.cuts[0]!.id, { scoreMilli: 3000 })],
    };
    expect(first('Saqué 4.2 en el parcial de Anatomía', ctx(done)).options[0]!.notice).toBe(
      'NO_PENDING_EVALUATIONS',
    );
  });
});

describe('raw points', () => {
  it('"18 de 20" on a scale that starts at 0 keeps the points and derives the grade by the core rule', () => {
    const s = first('Saqué 18 de 20 en el parcial de Bioquímica', ctx(bio));
    expect(s.status).toBe('READY');
    expect(resolved(s).request).toMatchObject({
      action: 'SCORE_EVALUATION',
      scoreMilli: 4500,
      rawEarnedMilli: 18_000,
      rawMaxMilli: 20_000,
    });
  });
  it('on a scale that does NOT start at 0 the points are kept and the grade is asked — never converted', () => {
    const base = subject(9, 'Cálculo', { profile: SCALE17 });
    const calc = { ...base, evaluations: [pendingEval(56, 'Parcial', base.cuts[0]!.id)] };
    const s = first('Saqué 18 de 20 en el parcial de Cálculo', ctx(calc));
    expect(s.status).toBe('NEEDS_REVIEW');
    expect(s.options[0]!.scoreMilli).toBeNull();
    expect(resolved(s).missing).toContain('CANONICAL');
    const given = resolved(s, { canonicalMilli: 6500 });
    expect(given.missing).toEqual([]);
    expect(given.request).toMatchObject({
      scoreMilli: 6500,
      rawEarnedMilli: 18_000,
      rawMaxMilli: 20_000,
    });
  });
  it('"Corte 1 de Matemáticas: 18/20" is a direct cut grade (scale from 0) or asks for the grade (scale from 1)', () => {
    expect(resolved(first('Corte 1 de Matemáticas: 18/20', ctx(mates))).request).toMatchObject({
      action: 'SET_CUT_GRADE',
      scoreMilli: 4500,
      rawEarnedMilli: 18_000,
    });
    const off = first('Corte 1 de Cálculo: 18/20', ctx(matesOffset));
    expect(off.status).toBe('NEEDS_REVIEW');
    expect(resolved(off).missing).toEqual(['CANONICAL']);
  });
  it('a grade outside the scale is a question, not a guess', () => {
    const s = first('Saqué 9.5 en el Corte 1 de Farmacología', ctx(farma));
    expect(s.options[0]!.scoreProblem).toBe('OUT_OF_RANGE');
    expect(s.status).toBe('NEEDS_REVIEW');
  });
});

describe('weights — "40 %" of WHAT', () => {
  it('"vale 40 %" alone is UNKNOWN: it is asked, never guessed', () => {
    const s = first('Parcial de Farmacología vale 40%', ctx(farma));
    expect(s.weight).toEqual({ basis: 'UNKNOWN', percentBp: 4000 });
    expect(s.status).toBe('NEEDS_REVIEW');
    expect(resolved(s).missing).toContain('BASIS');
  });
  it('"del Corte 1" is the cut; "de la nota final" is the final grade', () => {
    const cut = first('Parcial de Farmacología vale 40% del Corte 1', ctx(farma));
    expect(cut.weight.basis).toBe('GRADING_PERIOD');
    expect(resolved(cut).request).toMatchObject({
      action: 'CREATE_EVALUATION',
      gradingPeriodId: farma.cuts[0]!.id,
      periodShareBp: 4000,
      name: 'Parcial',
    });
    const final = first(
      'Parcial de Farmacología del Corte 2 vale 20% de la nota final',
      ctx(farma),
    );
    expect(final.weight.basis).toBe('FINAL');
    // Corte 2 is 30 % of the final grade: 20/30 of the cut is not a whole number of basis points
    expect(resolved(final).weightProblem).toBe('NOT_EXACT');
    expect(resolved(final).request).toBeNull();
  });
  it('"20 % of the final grade" inside a cut worth 40 % of it is exactly 50 % of the cut', () => {
    expect(weightToShareBp('FINAL', 2000, 4000)).toEqual({ bp: 5000, problem: null });
    expect(weightToShareBp('FINAL', 2000, 3000)).toEqual({ bp: null, problem: 'NOT_EXACT' });
    expect(weightToShareBp('FINAL', 6000, 3000)).toEqual({ bp: null, problem: 'OUT_OF_RANGE' });
    expect(weightToShareBp('GRADING_PERIOD', 4000, 3000)).toEqual({ bp: 4000, problem: null });
  });
  it('the student answering the basis settles it', () => {
    const s = first('Parcial de Farmacología del Corte 1 vale 40%', ctx(farma));
    expect(resolved(s, { basis: 'GRADING_PERIOD' }).request).toMatchObject({ periodShareBp: 4000 });
  });
});

describe('activity + evaluation — "Parcial de Anatomía el viernes, vale 40% del Corte 1"', () => {
  const text = 'Parcial de Anatomía el viernes, vale 40% del Corte 1';
  const proposal = {
    clientId: 'p1',
    groupId: 'g',
    selected: true,
    status: 'READY',
    rawSegment: 'Parcial de Anatomía el viernes',
    title: { value: 'Parcial', certainty: 'EXACT', origin: 'PARSED', withoutSubject: null },
    type: { value: 'EXAM', certainty: 'EXACT', origin: 'PARSED' },
    subject: {
      kind: 'EXISTING',
      id: anatomia.id,
      name: 'Anatomía',
      certainty: 'EXACT',
      origin: 'PARSED',
    },
    date: { value: '2026-10-23', certainty: 'EXACT', origin: 'PARSED', alternatives: [] },
    time: {
      value: null,
      hasTime: false,
      certainty: 'MISSING',
      origin: 'DEFAULT',
      alternatives: [],
      groupKey: null,
    },
    description: { value: null, certainty: 'MISSING', origin: 'DEFAULT', offered: null },
    blockingIssues: [],
    warnings: [],
    possibleRecurrence: false,
    duplicateOf: null,
  } as unknown as CaptureResult['proposals'][number];
  const capture = {
    status: 'OK',
    proposals: [proposal],
    suggestions: [],
    corrections: [],
    warnings: [],
    stats: { characters: text.length, found: 1, collapsed: 0, expected: null },
  } as CaptureResult;

  it('proposes an evaluation in Cortes 1 of THAT subject, with the weight in the cut, linked to the activity', () => {
    const g = interpretGrades(text, ctx(anatomia));
    expect(g.suggestions).toHaveLength(1);
    expect(g.maskedText).not.toMatch(/vale|40/); // the activity engine never sees the weight
    expect(g.maskedText).toMatch(/Parcial de Anatomía el viernes/);
    const merged = mergeGradeCapture(capture, g, new Set([anatomia.id]));
    expect(merged.capture.proposals).toHaveLength(1);
    const s = merged.grades.suggestions[0]!;
    expect(s.activityClientId).toBe('p1');
    expect(resolved(s).request).toMatchObject({
      action: 'CREATE_EVALUATION',
      gradingPeriodId: anatomia.cuts[0]!.id,
      periodShareBp: 4000,
      name: 'Parcial',
      activityClientId: 'p1',
    });
  });
  it('without a date there is no activity: only the evaluation', () => {
    const noDate = { ...proposal, date: { ...proposal.date, value: null } };
    const merged = mergeGradeCapture(
      { ...capture, proposals: [noDate] },
      interpretGrades(text, ctx(anatomia)),
      new Set([anatomia.id]),
    );
    expect(merged.capture.proposals).toHaveLength(0);
    expect(merged.grades.suggestions[0]!.activityClientId).toBeNull();
  });
  it('a subject of another study keeps the evaluation but the activity is NOT left alive in HOME', () => {
    const away = { ...anatomia, isHome: false };
    const merged = mergeGradeCapture(capture, interpretGrades(text, ctx(away)), new Set());
    expect(merged.grades.suggestions[0]!.activityClientId).toBeNull();
    expect(merged.grades.suggestions[0]!.activityNote).toBe('OTHER_STUDY');
    expect(merged.capture.proposals).toHaveLength(0);
  });
});

describe('conflicts between a direct grade and a breakdown', () => {
  it('"Saqué 4.2 en Corte 1" when the cut is broken down: no direct grade, the pending evaluations are offered', () => {
    const detailed = { ...anatomia };
    const s = first('Saqué 4.2 en el Corte 1 de Anatomía', ctx(detailed));
    const o = s.options[0]!;
    expect(o.notice).toBe('CUT_BROKEN_DOWN');
    expect(o.noticeCut).toBe('Corte 1');
    expect(o.choices.every((c) => c.action === 'SCORE_EVALUATION')).toBe(true);
    expect(s.status).toBe('NEEDS_REVIEW');
  });
  it('a new evaluation in a cut that has a direct grade does not silently change its mode', () => {
    const withDirect: GradeSubjectCtx = {
      ...farma,
      evaluations: [
        pendingEval(61, 'Nota de Corte 1', farma.cuts[0]!.id, {
          isCutGrade: true,
          scoreMilli: 3000,
        }),
      ],
    };
    const s = first('Parcial de Farmacología vale 40% del Corte 1', ctx(withDirect));
    expect(s.options[0]!.notice).toBe('CUT_HAS_DIRECT');
    expect(s.status).toBe('NEEDS_REVIEW');
  });
});

describe('no grading configuration', () => {
  it('says so and creates nothing; the parsed data stays in the suggestion', () => {
    const none = subject(10, 'Ética', { profile: null, cuts: [] });
    const s = first('Saqué 4.3 en el Corte 2 de Ética', ctx(none));
    expect(s.status).toBe('NEEDS_REVIEW');
    expect(s.options[0]!.config).toBe('NO_PROFILE');
    expect(s.options[0]!.notice).toBe('NO_CONFIG');
    expect(s.score.scoreMilli).toBe(4300);
    expect(resolved(s).missing).toEqual(['CONFIG']);
    const noCuts = subject(11, 'Redes', { cuts: [] });
    expect(first('Saqué 4.3 en el Corte 2 de Redes', ctx(noCuts)).options[0]!.config).toBe(
      'NO_CUTS',
    );
  });
});

describe('ambiguity is asked, never guessed', () => {
  const fisicaA = subject(20, 'Física', { studyName: 'Medicina' });
  const fisicaB = subject(21, 'Física', { studyName: 'Diplomado', periodId: U(901) });
  it('the same subject name in two studies: one option per study, nothing chosen', () => {
    const s = first('Saqué 4.3 en el Corte 2 de Física', ctx(fisicaA, fisicaB));
    expect(s.status).toBe('NEEDS_REVIEW');
    expect(s.autoOption).toBeNull();
    expect(s.options.map((o) => o.subject.studyName)).toEqual(['Medicina', 'Diplomado']);
    expect(resolved(s).missing).toEqual(['SUBJECT']);
    // the student picks one: the cut is resolved within THAT subject
    expect(resolved(s, { optionIndex: 1 }).request).toMatchObject({
      subjectId: fisicaB.id,
      gradingPeriodId: fisicaB.cuts[1]!.id,
    });
  });
  it('"Saqué 4.0 en el parcial" with several pending "Parcial" in different subjects', () => {
    const s = first('Saqué 4.0 en el parcial', ctx(anatomia, bio));
    expect(s.status).toBe('NEEDS_REVIEW');
    expect(s.subjectMentioned).toBe(false);
    expect(s.options.map((o) => o.subject.name)).toEqual(['Anatomía', 'Bioquímica']);
  });
  it('"Saqué 18/20" and "Saqué 4.5 en Corte 2" without a subject stay in review', () => {
    expect(first('Saqué 18/20', ctx(farma, anatomia)).status).toBe('NEEDS_REVIEW');
    const s = first('Saqué 4.5 en Corte 2', ctx(farma, mates));
    expect(s.status).toBe('NEEDS_REVIEW');
    expect(s.options.length).toBe(2);
  });
  it('words that are not about grades produce nothing', () => {
    expect(
      interpretGrades('Parcial de Anatomía el viernes a las 3/10', ctx(anatomia)).suggestions,
    ).toEqual([]);
    expect(interpretGrades('Tarea de Redes para el 15 de octubre', ctx(farma)).suggestions).toEqual(
      [],
    );
  });
});

describe('a weight and a score in the same sentence', () => {
  const text = 'Parcial de Anatomía el viernes, vale 40% del Corte 1 y saqué 4.2';
  it('keeps both: a new evaluation worth 40 % of Corte 1, already scored', () => {
    const s = first(text, ctx(anatomiaBase));
    expect(s.intent).toBe('NEW_EVALUATION');
    expect(s.weight).toMatchObject({ basis: 'GRADING_PERIOD', percentBp: 4000 });
    expect(s.score).toMatchObject({ kind: 'DECIMAL', scoreMilli: 4200 });
    expect(resolved(s).request).toMatchObject({
      action: 'CREATE_EVALUATION',
      periodShareBp: 4000,
      scoreMilli: 4200,
      gradingPeriodId: anatomiaBase.cuts[0]!.id,
    });
  });
  it('the activity engine reads ONLY the activity phrase', () => {
    const g = interpretGrades(text, ctx(anatomiaBase));
    expect(g.maskedText.trim()).toBe('Parcial de Anatomía el viernes,');
    expect(g.maskedText).not.toMatch(/saqu|4.2|40|Corte|vale/);
  });
  it('without a date and with the score first it still keeps both', () => {
    const s = first('Parcial de Anatomía vale 40% del Corte 1, saqué 4.2', ctx(anatomiaBase));
    expect(resolved(s).request).toMatchObject({ periodShareBp: 4000, scoreMilli: 4200 });
  });
  it('18/20 on a scale that starts at 0: canonical derived and the raw points kept', () => {
    const s = first('Parcial de Bioquímica vale 30% del Corte 2 y saqué 18/20', ctx(bioBase));
    expect(resolved(s).request).toMatchObject({
      action: 'CREATE_EVALUATION',
      periodShareBp: 3000,
      scoreMilli: 4500,
      rawEarnedMilli: 18000,
      rawMaxMilli: 20000,
    });
  });
  it('18/20 on a scale that does not start at 0: the raw is kept and the grade is asked', () => {
    const c = subject(6, 'Cálculo', { profile: SCALE17 });
    const s = first('Parcial de Cálculo vale 30% del Corte 2 y saqué 18/20', ctx(c));
    const r = resolved(s);
    expect(r.request).toBeNull();
    expect(r.missing).toContain('CANONICAL');
    const done = resolved(s, { canonicalMilli: 6000 });
    expect(done.request).toMatchObject({
      scoreMilli: 6000,
      rawEarnedMilli: 18000,
      rawMaxMilli: 20000,
    });
  });
  it('a score outside the scale is never silently dropped to pending', () => {
    const s = first('Parcial de Anatomía vale 40% del Corte 1 y saqué 9.5', ctx(anatomiaBase));
    const r = resolved(s);
    expect(r.request).toBeNull();
    expect(r.missing).toContain('CANONICAL');
  });
});

describe('one sentence is never split across studies', () => {
  const eng = subject(7, 'Inglés', {
    cutNames: ['Etapa 1', 'Etapa 2'],
    shares: [5000, 5000],
    studyName: 'Diplomado',
    studyType: 'OTHER_ACADEMIC',
    isHome: false,
  });
  const proposal = (subjectName: string) =>
    ({
      clientId: 'p1',
      rawSegment: 'Parcial de ' + subjectName + ' el viernes',
      date: { value: '2026-10-16', certainty: 'EXACT', alternatives: [] },
      subject: {
        kind: 'UNRESOLVED',
        reason: 'UNKNOWN_NAME',
        suggestedName: subjectName,
        candidates: [],
      },
      blockingIssues: [],
      warnings: [],
      duplicateOf: null,
    }) as unknown as CaptureResult['proposals'][number];
  const capture = (p: CaptureResult['proposals'][number]) =>
    ({
      status: 'OK',
      proposals: [p],
      suggestions: [],
      corrections: [],
      warnings: [],
      stats: { characters: 1, found: 1, collapsed: 0, expected: null },
    }) as CaptureResult;

  it('a subject that only exists in a secondary study: the evaluation stays, no HOME activity, no HOME subject', () => {
    const text = 'Parcial de Inglés el viernes, vale 40% de la Etapa 1';
    const g = interpretGrades(text, ctx(farma, eng));
    const merged = mergeGradeCapture(capture(proposal('Inglés')), g, new Set([farma.id]));
    expect(merged.capture.proposals).toEqual([]);
    const s = merged.grades.suggestions[0]!;
    expect(s.activityClientId).toBeNull();
    expect(s.activityNote).toBe('OTHER_STUDY');
    expect(resolved(s).request).toMatchObject({
      action: 'CREATE_EVALUATION',
      subjectId: eng.id,
      periodShareBp: 4000,
    });
  });
  it('the same name in HOME and in a secondary study: linked to the HOME option, never to the other', () => {
    const home = subject(8, 'Farmacología');
    const other = subject(9, 'Farmacología', { studyName: 'Diplomado', isHome: false });
    const g = interpretGrades(
      'Parcial de Farmacología el viernes, vale 40% del Corte 1',
      ctx(home, other),
    );
    const merged = mergeGradeCapture(capture(proposal('Farmacología')), g, new Set([home.id]));
    const s = merged.grades.suggestions[0]!;
    expect(s.activityClientId).toBe('p1'); // kept for the HOME option
    expect(s.options.map((o) => o.subject.isHome).sort()).toEqual([false, true]);
    expect(
      resolved(s, { optionIndex: s.options.findIndex((o) => !o.subject.isHome), choiceIndex: 0 })
        .request,
    ).toMatchObject({ subjectId: other.id });
  });
});
