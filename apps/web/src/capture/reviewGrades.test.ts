import { interpretGrades, type GradeCaptureContext } from '@planner/core';
import { describe, expect, it } from 'vitest';
import { toCaptureDraft, captureDraftSchema } from './captureDraft';
import {
  buildConfirmRequest,
  confirmLabel,
  createdMessage,
  createReview,
  gradeView,
  setGradeBasis,
  setGradeSubject,
  summarize,
  toggleGrade,
} from './reviewModel';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
const cuts = (base: number) =>
  [1, 2, 3].map((n) => ({
    id: id(base + n),
    name: `Corte ${n}`,
    position: n,
    finalShareBp: n === 3 ? 4000 : 3000,
  }));
const subject = (n: number, name: string, studyName: string | null = 'Medicina') => ({
  id: id(n),
  name,
  periodId: id(900 + n),
  studyName,
  studyType: 'UNIVERSITY' as const,
  isHome: true,
  profile: SCALE,
  cuts: cuts(n * 10),
  evaluations: [],
});
const ctx = (...subjects: GradeCaptureContext['subjects']): GradeCaptureContext => ({ subjects });
const reviewOf = (text: string, c: GradeCaptureContext) =>
  createReview(
    { proposals: [], corrections: [], suggestions: [], warnings: [] },
    interpretGrades(text, c).suggestions,
  );

describe('review of grades', () => {
  it('a direct cut grade is ticked, complete and said in plain words', () => {
    const state = reviewOf(
      'Saqué 4.3 en el Corte 2 de Farmacología',
      ctx(subject(1, 'Farmacología')),
    );
    expect(state.grades).toHaveLength(1);
    expect(state.grades[0]!.selected).toBe(true);
    const view = gradeView(state.grades[0]!);
    expect(view).toMatchObject({ subject: 'Farmacología', cut: 'Corte 2', score: 'Nota: 4.3' });
    const req = buildConfirmRequest(state);
    expect(req.evaluations).toHaveLength(1);
    expect(req.evaluations![0]).toMatchObject({ action: 'SET_CUT_GRADE', scoreMilli: 4300 });
    expect(summarize(state)).toMatchObject({ grades: 1, gradesToCreate: 1, needsReview: 0 });
    expect(confirmLabel(summarize(state))).toBe('Guardar 1 nota');
  });

  it('the card never shows internal terms', () => {
    const state = reviewOf(
      'Saqué 18 de 20 en el Corte 1 de Farmacología',
      ctx(subject(1, 'Farmacología')),
    );
    const text = JSON.stringify(gradeView(state.grades[0]!));
    expect(text).not.toMatch(/scoreMilli|periodShareBp|isCutGrade|Evaluation|rawEarned/);
    expect(gradeView(state.grades[0]!).score).toBe('Nota: 4.5 (18 / 20)');
  });

  it('the same subject in two studies is a question, never picked: it waits, sends nothing, and answering completes it', () => {
    const state = reviewOf(
      'Saqué 4.3 en el Corte 2 de Farmacología',
      ctx(subject(1, 'Farmacología', 'Medicina'), subject(2, 'Farmacología', 'Enfermería')),
    );
    expect(state.grades[0]!.selected).toBe(false);
    expect(buildConfirmRequest(state).evaluations).toBeUndefined();
    expect(summarize(state).needsReview).toBe(1);
    const answered = setGradeSubject(state, state.grades[0]!.suggestion.clientId, 1);
    expect(answered.grades[0]!.selected).toBe(true); // complete -> ticks itself
    expect(buildConfirmRequest(answered).evaluations![0]).toMatchObject({ subjectId: id(2) });
  });

  it('an ambiguous percentage waits for "¿corte o nota final?" and never guesses', () => {
    const state = reviewOf('Parcial de Farmacología vale 40%', ctx(subject(1, 'Farmacología')));
    const g = state.grades[0]!;
    expect(g.suggestion.weight.basis).toBe('UNKNOWN');
    expect(buildConfirmRequest(state).evaluations).toBeUndefined();
    const withBasis = setGradeBasis(
      { ...state, grades: [{ ...g, selection: { ...g.selection, choiceIndex: 0 } }] },
      g.suggestion.clientId,
      'GRADING_PERIOD',
    );
    expect(buildConfirmRequest(withBasis).evaluations?.[0]).toMatchObject({
      action: 'CREATE_EVALUATION',
      periodShareBp: 4000,
    });
  });

  it('unticking a grade leaves it out of the request', () => {
    const state = reviewOf(
      'Saqué 4.3 en el Corte 2 de Farmacología',
      ctx(subject(1, 'Farmacología')),
    );
    const off = toggleGrade(state, state.grades[0]!.suggestion.clientId, false);
    expect(buildConfirmRequest(off).evaluations).toBeUndefined();
  });

  it('a grade with no configuration is incomplete and keeps what was parsed', () => {
    const bare = { ...subject(1, 'Farmacología'), profile: null, cuts: [] };
    const state = reviewOf('Saqué 4.3 en el Corte 2 de Farmacología', ctx(bare));
    expect(state.grades[0]!.selected).toBe(false);
    expect(buildConfirmRequest(state).evaluations).toBeUndefined();
    expect(state.grades[0]!.suggestion.score.scoreMilli).toBe(4300);
  });

  it('survives the draft: reload keeps the grade as it was', () => {
    const state = reviewOf(
      'Saqué 4.3 en el Corte 2 de Farmacología',
      ctx(subject(1, 'Farmacología')),
    );
    const draft = toCaptureDraft('Saqué 4.3 en el Corte 2 de Farmacología', state)!;
    const back = captureDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(back.review!.grades).toHaveLength(1);
    expect(back.review!.grades[0]!.suggestion.clientId).toBe(state.grades[0]!.suggestion.clientId);
    // a draft saved before grades existed still opens
    const old = JSON.parse(JSON.stringify(draft));
    delete old.review.grades;
    expect(captureDraftSchema.parse(old).review!.grades).toEqual([]);
  });

  it('messages: scores saved and evaluations added', () => {
    expect(
      createdMessage({
        count: 1,
        createdBlocks: [],
        reusedBlocks: [],
        evaluations: [{ action: 'CREATE_EVALUATION' }, { action: 'SET_CUT_GRADE' }],
      }),
    ).toBe('1 actividad creada y 1 nota guardada y 1 evaluación agregada.');
  });
});
