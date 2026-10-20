import { buildGradeContext, type Progress } from '@planner/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { gradeContextText } from '../radar/GradeContextLine';
import { SubjectGradeList } from './SubjectGradeList';

const SCALE = { maxMilli: 5000, decimals: 1 };
const row = (
  name: string,
  share: number,
  cut: number,
  score: number | null,
  isCutGrade = false,
) => ({
  id: name,
  name,
  cutName: 'Corte 1',
  isCutGrade,
  scoreMilli: score,
  periodShareBp: share,
  cutFinalShareBp: cut,
});

describe('Radar: the grade context line', () => {
  it('pending: "Parcial · Corte 1 · 12 % de la nota final"', () => {
    expect(gradeContextText(buildGradeContext([row('Parcial', 4000, 3000, null)], SCALE)!)).toBe(
      'Parcial · Corte 1 · 12 % de la nota final',
    );
  });
  it('graded: "Parcial · Corte 1 · 12 % · Nota 4.2" (no repeated words)', () => {
    expect(gradeContextText(buildGradeContext([row('Parcial', 4000, 3000, 4200)], SCALE)!)).toBe(
      'Parcial · Corte 1 · 12 % · Nota 4.2',
    );
  });
  it('several: compact, none chosen', () => {
    const c = buildGradeContext(
      [row('Parcial', 4000, 3000, null), row('Quiz', 2000, 3000, 3800)],
      SCALE,
    )!;
    expect(gradeContextText(c)).toBe('2 evaluaciones · 18 % de la nota final');
  });
  it('neutral wording: no judgement words', () => {
    const text = gradeContextText(buildGradeContext([row('Parcial', 4000, 3000, 1200)], SCALE)!);
    expect(text).not.toMatch(/mal|perd|peligro|riesgo|excelente|mejorar|bajo/i);
  });
});

describe('Progress: the Notas section, apart from the activities', () => {
  const base = {
    periodId: '00000000-0000-4000-8000-000000000900',
    color: '#123456',
    total: 10,
    completed: 7,
    pending: 3,
    inProgress: 0,
    overdue: 0,
    percentage: 70,
  };
  const grade = (over: Partial<NonNullable<Progress['subjects'][number]['grade']>>) => ({
    accumulatedMilli: 1200,
    currentMilli: 4000,
    maxMilli: 5000,
    passMilli: 3000,
    decimals: 1,
    evaluatedWeightUnits: 30_000_000,
    remainingWeightUnits: 70_000_000,
    cutsWithGrade: 1,
    cutsTotal: 3,
    complete: true,
    ...over,
  });
  const render = (subjects: Progress['subjects']) =>
    renderToStaticMarkup(
      <StaticRouter location="/progress">
        <SubjectGradeList subjects={subjects} />
      </StaticRouter>,
    );
  const subject = (id: string, name: string, g: ReturnType<typeof grade> | null) =>
    ({
      ...base,
      id: `00000000-0000-4000-8000-00000000000${id}`,
      name,
      grade: g,
    }) as Progress['subjects'][number];

  it('partial: "Acumulada 1.2 / 5.0", "1 de 3 cortes con nota" and the average of what is registered', () => {
    const html = render([subject('1', 'Ciberseguridad', grade({}))]);
    expect(html).toContain('Notas');
    expect(html).toContain('Acumulada 1.2 / 5.0');
    expect(html).toContain('1 de 3 cortes con nota');
    expect(html).toContain('Promedio de lo registrado: 4.0');
    expect(html).toContain('Ver notas');
  });

  it('complete: "3.9 / 5.0" and "3 de 3 cortes con nota", never called a partial', () => {
    const html = render([
      subject(
        '1',
        'Ciberseguridad',
        grade({
          accumulatedMilli: 3910,
          currentMilli: 3910,
          cutsWithGrade: 3,
          remainingWeightUnits: 0,
        }),
      ),
    ]);
    expect(html).toContain('3.9 / 5.0');
    expect(html).toContain('3 de 3 cortes con nota');
    expect(html).not.toContain('Acumulada');
  });

  it('configured but nothing graded: words, never 0.0', () => {
    const html = render([
      subject(
        '1',
        'Redes',
        grade({ accumulatedMilli: null, currentMilli: null, cutsWithGrade: 0 }),
      ),
    ]);
    expect(html).toContain('Sin notas todavía');
    expect(html).not.toContain('0.0');
  });

  it('a subject without grade configuration is not listed, and with none at all the section is absent', () => {
    expect(render([subject('1', 'Sin config', null)])).toBe('');
    const html = render([subject('1', 'Sin config', null), subject('2', 'Con notas', grade({}))]);
    expect(html).not.toContain('Sin config');
    expect(html).toContain('Con notas');
  });

  it('incomplete weights say it is an estimate; long names wrap; no judgement words', () => {
    const long = 'Asignatura con un nombre extraordinariamente largo '.repeat(3);
    const html = render([subject('1', long, grade({ complete: false }))]);
    expect(html).toContain('Estimación: faltan pesos por definir.');
    expect(html).toContain('break-words');
    expect(html).not.toMatch(/vas mal|perdiendo|peligro|riesgo|excelente|debes mejorar/i);
  });

  it('keeps the two ideas apart: no activity percentage inside the grades section', () => {
    const html = render([subject('1', 'Ciberseguridad', grade({}))]);
    expect(html).not.toContain('70%');
    expect(html).toContain('no se mezclan en un mismo porcentaje');
  });
});
