import { interpretGrades, type GradeCaptureContext, type GradeSubjectCtx } from '@planner/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CaptureReview } from './CaptureReview';
import { confirmLabel, createReview, summarize } from './reviewModel';

/** QA real: a subject written but not among the current ones must not offer unrelated subjects. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const subject = (n: number, name: string): GradeSubjectCtx => ({
  id: id(n),
  name,
  periodId: id(900),
  studyName: 'Ingeniería',
  studyType: 'UNIVERSITY',
  isHome: true,
  profile: { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 },
  cuts: [1, 2, 3].map((p) => ({
    id: id(n * 10 + p),
    name: `Corte ${p}`,
    position: p,
    finalShareBp: p === 3 ? 4000 : 3000,
  })),
  evaluations: [],
});
const context: GradeCaptureContext = {
  subjects: [subject(1, 'Base de datos SQL - NOSQL'), subject(2, 'Ciberseguridad')],
};
const review = (text: string) =>
  createReview(
    { proposals: [], corrections: [], suggestions: [], warnings: [] },
    interpretGrades(text, context).suggestions,
  );
const render = (state: ReturnType<typeof review>) =>
  renderToStaticMarkup(
    <StaticRouter location="/dashboard">
      <CaptureReview
        level={3}
        state={state}
        onChange={() => undefined}
        subjects={[]}
        pending={false}
        onConfirm={() => undefined}
        onBack={() => undefined}
        onDiscard={() => undefined}
      />
    </StaticRouter>,
  );

describe('a subject written that does not exist', () => {
  const state = review('Saqué 4.3 en Corte 2 de Farmacología');
  const html = render(state);

  it('says it was not found, keeps what was understood and offers no other subject', () => {
    expect(html).toContain('No encontré «Farmacología» entre tus materias actuales.');
    expect(html).toContain('Asignatura no encontrada');
    expect(html).toContain('Corte 2');
    expect(html).toContain('Nota: 4.3');
    expect(html).toContain('Volver al texto');
    expect(html).not.toContain('Base de datos SQL - NOSQL');
    expect(html).not.toContain('Ciberseguridad');
    expect(html).not.toContain('¿A cuál asignatura te refieres?');
  });

  it('is not selected, has no request and the button says to resolve first (never "Crear 0 actividades")', () => {
    expect(state.grades[0]!.selected).toBe(false);
    const summary = summarize(state);
    expect(summary).toMatchObject({ grades: 1, gradesToCreate: 0, needsReview: 1, toCreate: 0 });
    expect(confirmLabel(summary)).toBe('Resolver antes de guardar');
    expect(html).toContain('Resolver antes de guardar');
    expect(html).not.toContain('Crear 0 actividades');
    expect(html).toContain('1 nota');
  });

  it('survives into the draft (the written text is part of the suggestion)', () => {
    expect(state.grades[0]!.suggestion.explicitUnknownSubjectText).toBe('Farmacología');
  });
});

describe('no subject written at all, or a real one', () => {
  it('without a subject, the current subjects can be offered', () => {
    const html = render(review('Saqué 4.3 en Corte 2'));
    expect(html).toContain('¿A cuál asignatura te refieres?');
    expect(html).toContain('Ciberseguridad');
    expect(html).not.toContain('No encontré');
  });

  it('an existing subject resolves and the button saves the grade', () => {
    const state = review('Saqué 4.3 en Corte 2 de Ciberseguridad');
    expect(state.grades[0]!.selected).toBe(true);
    expect(confirmLabel(summarize(state))).toBe('Guardar 1 nota');
    expect(render(state)).not.toContain('No encontré');
  });

  it('the label rules: 1 activity + 1 grade, nothing at all', () => {
    const base = summarize(review('Saqué 4.3 en Corte 2 de Ciberseguridad'));
    expect(confirmLabel({ ...base, toCreate: 1 })).toBe('Crear 1 actividad y 1 nota');
    expect(confirmLabel({ ...base, gradesToCreate: 0, needsReview: 0 })).toBe(
      'Crear 0 actividades',
    );
  });
});

describe('the summary line of a new evaluation', () => {
  it('says the cut ONCE: "Corte 1 · Parcial · 40 % · Nota: Pendiente"', () => {
    const html = render(review('Parcial de Ciberseguridad vale 40% del Corte 1'));
    const line = />([^<]*Nota: Pendiente[^<]*)</.exec(html)?.[1];
    expect(line).toBeDefined();
    expect(line!.split('Corte 1')).toHaveLength(2); // exactly one occurrence
    expect(line).toMatch(/^Corte 1 · Parcial · 40 % · Nota: Pendiente$/);
  });
});
