import { interpretGrades, type GradeCaptureContext } from '@planner/core';
import { describe, expect, it } from 'vitest';
import { toCaptureDraft, captureDraftSchema } from './captureDraft';
import {
  agendaBlocked,
  buildConfirmRequest,
  confirmLabel,
  createdMessage,
  createReview,
  gradeView,
  setGradeBasis,
  setGradeSubject,
  summarize,
  toggle,
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
const toggleOn = (st: ReturnType<typeof createReview>) => ({
  ...st,
  items: st.items.map((i) => ({ ...i, selected: true })),
  grades: st.grades.map((g) => ({ ...g, selected: true })),
});
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
  it('a new evaluation that comes scored previews its score, not "Pendiente"', () => {
    const state = reviewOf(
      'Parcial de Farmacología vale 40% del Corte 1 y saqué 4.2',
      ctx(subject(1, 'Farmacología')),
    );
    const view = gradeView(state.grades[0]!);
    expect(view.score).toBe('Nota: 4.2');
    expect(view.weight).toBe('40 %');
    expect(buildConfirmRequest(state).evaluations![0]).toMatchObject({
      action: 'CREATE_EVALUATION',
      periodShareBp: 4000,
      scoreMilli: 4200,
    });
  });

  it('choosing the secondary-study subject blocks the HOME activity of the same sentence; choosing HOME keeps both', () => {
    const home = subject(1, 'Farmacología', 'Medicina');
    const other = { ...subject(2, 'Farmacología', 'Diplomado'), isHome: false };
    const g = interpretGrades(
      'Parcial de Farmacología el viernes, vale 40% del Corte 1',
      ctx(home, other),
    ).suggestions[0]!;
    const proposal = {
      clientId: 'p1',
      selected: true,
      duplicateOf: null,
      subject: { kind: 'EXISTING', id: home.id, name: 'Farmacología' },
      title: { value: 'Parcial', withoutSubject: null },
      type: { value: 'EXAM' },
      date: { value: '2026-10-16', certainty: 'EXACT', alternatives: [] },
      time: { value: null, certainty: 'MISSING', groupKey: null },
      description: { value: null },
      blockingIssues: [],
      warnings: [],
    };
    const base = createReview(
      { proposals: [proposal as never], corrections: [], suggestions: [], warnings: [] },
      [{ ...g, activityClientId: 'p1' }],
    );
    const gid = g.clientId;
    const pickedHome = setGradeSubject(
      base,
      gid,
      g.options.findIndex((o) => o.subject.isHome),
    );
    const pickedOther = setGradeSubject(
      base,
      gid,
      g.options.findIndex((o) => !o.subject.isHome),
    );
    expect(agendaBlocked(pickedHome, 'p1')).toBe(false);
    expect(agendaBlocked(pickedOther, 'p1')).toBe(true);
    const sel = (st: typeof base) => ({
      ...st,
      grades: st.grades.map((x) => ({ ...x, selection: { ...x.selection, choiceIndex: 0 } })),
    });
    const reqHome = buildConfirmRequest(toggleOn(sel(pickedHome)));
    expect(reqHome.items).toHaveLength(1);
    expect(reqHome.evaluations![0]).toMatchObject({ activityClientId: 'p1' });
    const reqOther = buildConfirmRequest(toggleOn(sel(pickedOther)));
    expect(reqOther.items).toHaveLength(0); // never splits one sentence across studies
    expect(reqOther.evaluations![0]!.subjectId).toBe(other.id);
    expect(reqOther.evaluations![0]).not.toHaveProperty('activityClientId');
  });

  describe('a blocked activity (grade subject in another study) can never come back by hand', () => {
    const home = subject(1, 'Farmacología', 'Medicina');
    const other = { ...subject(2, 'Farmacología', 'Diplomado'), isHome: false };
    const g = interpretGrades(
      'Parcial de Farmacología el viernes, vale 40% del Corte 1',
      ctx(home, other),
    ).suggestions[0]!;
    const proposal = {
      clientId: 'p1',
      selected: true,
      duplicateOf: null,
      subject: { kind: 'EXISTING', id: home.id, name: 'Farmacología' },
      title: { value: 'Parcial', withoutSubject: null },
      type: { value: 'EXAM' },
      date: { value: '2026-10-16', certainty: 'EXACT', alternatives: [] },
      time: { value: null, certainty: 'MISSING', groupKey: null },
      description: { value: null },
      blockingIssues: [],
      warnings: [],
    };
    const base = createReview(
      { proposals: [proposal as never], corrections: [], suggestions: [], warnings: [] },
      [{ ...g, activityClientId: 'p1' }],
    );
    const homeAt = g.options.findIndex((o) => o.subject.isHome);
    const otherAt = g.options.findIndex((o) => !o.subject.isHome);
    const withTarget = (st: typeof base) => ({
      ...st,
      grades: st.grades.map((x) => ({ ...x, selection: { ...x.selection, choiceIndex: 0 } })),
    });

    it('before choosing the subject it is a question and nothing is blocked', () => {
      expect(base.grades[0]!.selected).toBe(false);
      expect(agendaBlocked(base, 'p1')).toBe(false);
    });

    it('choosing the secondary subject unticks it, blocks it and the summary does not count it', () => {
      const st = withTarget(setGradeSubject(toggle(base, 'p1', true), g.clientId, otherAt));
      expect(agendaBlocked(st, 'p1')).toBe(true);
      expect(st.items[0]!.selected).toBe(false);
      const sum = summarize(st);
      expect(sum.toCreate).toBe(0);
      expect(sum.gradesToCreate).toBe(1);
      expect(confirmLabel(sum)).toBe('Guardar 1 nota');
    });

    it('ticking it by hand does not work', () => {
      const st = withTarget(setGradeSubject(base, g.clientId, otherAt));
      expect(toggle(st, 'p1', true).items[0]!.selected).toBe(false);
    });

    it('an impossible state (blocked and ticked) still sends no activity, only the evaluation', () => {
      const st = withTarget(setGradeSubject(base, g.clientId, otherAt));
      const forged = toggleOn(st);
      const req = buildConfirmRequest(forged);
      expect(req.items).toEqual([]);
      expect(req.evaluations![0]!.subjectId).toBe(other.id);
      expect(summarize(forged).toCreate).toBe(0);
    });

    it('choosing HOME again restores the valid activity + evaluation flow', () => {
      const blocked = withTarget(setGradeSubject(base, g.clientId, otherAt));
      const back = setGradeSubject(blocked, g.clientId, homeAt);
      const st = withTarget(back);
      expect(agendaBlocked(st, 'p1')).toBe(false);
      expect(toggle(st, 'p1', true).items[0]!.selected).toBe(true);
      const req = buildConfirmRequest(toggleOn(st));
      expect(req.items).toHaveLength(1);
      expect(req.evaluations![0]).toMatchObject({ subjectId: home.id, activityClientId: 'p1' });
    });
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
