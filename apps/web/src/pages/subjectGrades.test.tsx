import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes, StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type {
  AcademicPeriod,
  Activity,
  Evaluation,
  GradingPeriod,
  GradingProfile,
  StudyTrack,
  Subject,
  SubjectGradeSummaryDto,
  SubjectGradesResponse,
} from '@planner/core';
import { ApiRequestError } from '../api/client';
import {
  SUBJECT_GRADES_KEY,
  isGradesOfPeriod,
  subjectGradesKey,
  subjectKey,
} from '../grading/useGrading';
import { ConfirmRemoveDialog } from './grades/ConfigDialogs';
import { SetupDialog } from './grades/SetupDialog';
import { GradesNotFound, SubjectGradesPage, isNotFound } from './SubjectGradesPage';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = '2026-10-01T00:00:00.000Z';
const SUBJECT_ID = U(3);
const PERIOD_ID = U(2);
const TRACK_ID = U(5);

const subject = (over: Partial<Subject> = {}): Subject =>
  ({
    id: SUBJECT_ID,
    periodId: PERIOD_ID,
    name: 'Farmacología',
    color: '#3B82F6',
    ...over,
  }) as Subject;
const period = (over: Partial<AcademicPeriod> = {}): AcademicPeriod => ({
  id: PERIOD_ID,
  name: '2026-2',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId: TRACK_ID,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const track = (over: Partial<StudyTrack> = {}): StudyTrack => ({
  id: TRACK_ID,
  name: 'Medicina',
  type: 'UNIVERSITY',
  programKey: null,
  isPrimary: true,
  status: 'ACTIVE',
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const profile: GradingProfile = {
  id: U(1),
  periodId: PERIOD_ID,
  minMilli: 0,
  maxMilli: 5000,
  passMilli: 3000,
  decimals: 1,
  createdAt: iso,
  updatedAt: iso,
};
const cut = (n: number, bp: number, name = `Corte ${n}`): GradingPeriod => ({
  id: U(10 + n),
  periodId: PERIOD_ID,
  subjectId: SUBJECT_ID,
  name,
  position: n,
  finalShareBp: bp,
  createdAt: iso,
  updatedAt: iso,
});
const evaluation = (n: number, cutId: string, over: Partial<Evaluation> = {}): Evaluation => ({
  id: U(100 + n),
  periodId: PERIOD_ID,
  subjectId: SUBJECT_ID,
  gradingPeriodId: cutId,
  activityId: null,
  name: `Evaluación ${n}`,
  periodShareBp: 5000,
  scoreMilli: null,
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
  evaluatedWeightUnits: 30_000_000,
  remainingWeightUnits: 70_000_000,
  currentMilli: 4300,
  currentPasses: true,
  required: { status: 'NEEDED', requiredMilli: 2250 },
  ...over,
});

interface Seed {
  period?: AcademicPeriod;
  track?: StudyTrack | null;
  grades?: Partial<SubjectGradesResponse>;
  activities?: Activity[];
}

/** What the server derives for the page: the period and its study ride in the grades response (null study = untracked period). */
const contextOf = (p: AcademicPeriod, t: StudyTrack | null) => ({
  period: { id: p.id, name: p.name, studyTrackId: p.studyTrackId },
  studyTrack: t && { id: t.id, name: t.name, type: t.type, status: t.status },
});

function render(seed: Seed = {}, c = new QueryClient()) {
  const p = seed.period ?? period();
  const t = seed.track === undefined ? track() : seed.track;
  c.setQueryData(subjectKey(SUBJECT_ID), subject());
  // Deliberately NOT seeded: the periods list and the studies list. The screen must not depend on them (or on their loading).
  c.setQueryData(['activities', { subjectId: SUBJECT_ID }], seed.activities ?? []);
  c.setQueryData(subjectGradesKey(SUBJECT_ID), {
    subjectId: SUBJECT_ID,
    periodId: PERIOD_ID,
    ...contextOf(p, t),
    profile: null,
    gradingPeriods: [],
    evaluations: [],
    summary: null,
    ...seed.grades,
  } satisfies SubjectGradesResponse);
  return html(c);
}
const html = (c: QueryClient, location = `/subjects/${SUBJECT_ID}/grades`) =>
  renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <StaticRouter location={location}>
        <Routes>
          <Route path="/subjects/:subjectId/grades" element={<SubjectGradesPage />} />
        </Routes>
      </StaticRouter>
    </QueryClientProvider>,
  );

const configured = (over: Partial<SubjectGradesResponse> = {}): Partial<SubjectGradesResponse> => ({
  profile,
  gradingPeriods: [cut(1, 3000), cut(2, 3000), cut(3, 4000)],
  evaluations: [],
  summary: summary({
    currentMilli: null,
    currentPasses: null,
    evaluatedWeightUnits: 0,
    remainingWeightUnits: 100_000_000,
  }),
  ...over,
});

describe('the subject grades page', () => {
  it('one h1 for the page, the subject and its period, and a way back', () => {
    const out = render({ grades: configured() });
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('Notas de Farmacología');
    expect(out).toContain('2026-2');
    expect(out).toContain('href="/subjects"');
  });

  it('without a scale: asks for the period’s scale first, then how THIS subject is split, with one clear action', () => {
    const out = render();
    expect(out).toContain('Configura las notas de esta materia');
    expect(out).toContain('la escala, que se comparte con las demás materias de este periodo');
    expect(out).toContain('cómo se divide la nota final de Farmacología');
    expect(out).toContain('Configurar notas');
    expect(out).not.toContain('Nota acumulada');
  });

  it('with the scale already configured but no cuts for THIS subject: asks how it is split (nothing inherited)', () => {
    const out = render({ grades: { profile, gradingPeriods: [], evaluations: [], summary: null } });
    expect(out).toContain('¿Cómo se divide esta materia?');
    expect(out).toContain('Configurar cortes');
    expect(out).toContain('Cada materia tiene sus propios cortes y porcentajes');
    expect(out).not.toContain('Corte 1'); // the 30/30/40 of another subject is not shown here
    expect(out).not.toContain('Nota acumulada');
    expect(out).not.toContain('Registrar nota');
  });

  it('the study type comes from the real study, never a default while anything loads', () => {
    // SCHOOL / OTHER with the periods and studies lists NOT loaded at all (they are not even seeded): no university words
    for (const type of ['SCHOOL', 'OTHER_ACADEMIC'] as const) {
      const out = render({
        track: track({ type }),
        grades: { profile, gradingPeriods: [], evaluations: [], summary: null },
      });
      expect(out, type).not.toMatch(/cortes/i);
      expect(out, type).not.toContain('Corte 1');
    }
    expect(
      render({ grades: { profile, gradingPeriods: [], evaluations: [], summary: null } }),
    ).toContain('Configurar cortes');
  });

  it('a period that names a study whose context is missing is retried, never read as a university', () => {
    const out = render({ track: null }); // studyTrackId is set, the study did not arrive
    expect(out).toContain('No pudimos cargar el estudio de este periodo.');
    expect(out).toContain('Reintentar');
    expect(out).not.toContain('Configurar notas');
    expect(out).not.toMatch(/cortes/i);
    expect(out).not.toContain('/onboarding');
  });

  it('the archived notice appears only when the real study is archived', () => {
    expect(render({ track: track({ status: 'ACTIVE' }) })).not.toContain(
      'Este estudio está archivado',
    );
    expect(render({ track: track({ status: 'ARCHIVED' }) })).toContain(
      'Este estudio está archivado',
    );
  });

  it('uses the words of the study: Periodos de evaluación (school), Etapas (other study)', () => {
    const empty = { profile, gradingPeriods: [], evaluations: [], summary: null };
    expect(render({ track: track({ type: 'SCHOOL' }), grades: empty })).toContain(
      'Configurar periodos de evaluación',
    );
    expect(render({ track: track({ type: 'OTHER_ACADEMIC' }), grades: empty })).toContain(
      'Configurar etapas',
    );
  });

  it('a period without a study cannot be graded: it says why and points to Mis estudios', () => {
    // untracked: the answer itself says so (no study to wait for, no type invented)
    const out = render({ period: period({ studyTrackId: null }), track: null });
    expect(out).toContain('Las notas necesitan un estudio');
    expect(out).toContain('href="/settings/studies"');
    expect(out).not.toContain('Configurar notas');
  });

  it('configured and empty: every cut is "Pendiente" with a button to register its grade — no evaluation form to start', () => {
    const out = render({ grades: configured() });
    expect(out).toContain('Sin notas todavía');
    expect(out).toContain('Objetivo para aprobar');
    expect(out).toContain('30 % de la nota final');
    expect(out).toContain('40 % de la nota final');
    expect(out).toContain('aria-label="Registrar nota de Corte 3"');
    expect(out.match(/Pendiente/g)!.length).toBeGreaterThanOrEqual(3);
    expect(out).not.toContain('Aún no hay evaluaciones');
    expect(out).not.toContain('Agregar evaluación a'); // breaking a cut down is the secondary path (the menu)
    expect(out).not.toMatch(/Nombre/); // registering a cut's grade never asks for a name
  });

  it('30/30/40 with only the second cut graded 4.5: the accumulated grade, the contribution and no estimate', () => {
    const [c1, c2, c3] = [cut(1, 3000), cut(2, 3000), cut(3, 4000)];
    const out = render({
      grades: configured({
        gradingPeriods: [c1, c2, c3],
        evaluations: [
          evaluation(2, c2.id, {
            periodShareBp: 10_000,
            scoreMilli: 4500,
            isCutGrade: true,
            name: 'Nota de Corte 2',
          }),
        ],
        summary: summary({
          complete: true,
          currentMilli: 4500,
          evaluatedWeightUnits: 30_000_000,
          remainingWeightUnits: 70_000_000,
          undefinedWeightUnits: 0,
          required: { status: 'NEEDED', requiredMilli: 2358 },
        }),
      }),
    });
    expect(out).toContain('Resumen de notas');
    expect(out).toMatch(/data-testid="accumulated-grade"[^>]*>1\.4</); // 1.35 shown with one decimal
    expect(out).toContain('/ 5.0');
    expect(out).toContain('Lo que ya llevas acumulado en la nota final.');
    expect(out).toContain('1 de 3 cortes con nota');
    expect(out).toContain('Objetivo para aprobar');
    expect(out).toMatch(/data-testid="current-grade"[^>]*>4\.5</);
    expect(out).toContain('Promedio de lo registrado');
    expect(out).toContain('Calificado 30 %');
    expect(out).toContain('Pendiente 70 %');
    expect(out).toContain(
      'Necesitas aproximadamente 2.4 de promedio en el 70 % restante para llegar a 3.0.',
    );
    expect(out).toContain('Queda 70 % de la nota final.');
    expect(out).not.toContain('Estimación'); // the weights ARE defined; only the grades are missing
    expect(out).not.toContain('faltan pesos');
    // the card of the graded cut: the grade and what it adds; the others stay pending
    expect(out).toContain('Aporta a la definitiva: 1.35');
    expect(out).toContain('aria-label="Editar nota de Corte 2"');
    expect(out).not.toContain('Lo evaluado hasta ahora'); // no textual verdict in the summary
    expect(out).not.toContain('lo pendiente cuenta 0'); // not the main explanation of the accumulated grade
  });

  it('QA case: the three cuts graded 3.2 / 4.5 / 4.0 is 3.9 / 5.0, fully graded, with nothing to ask or estimate', () => {
    const [c1, c2, c3] = [cut(1, 3000), cut(2, 3000), cut(3, 4000)];
    const direct = (n: number, id: string, scoreMilli: number) =>
      evaluation(n, id, {
        periodShareBp: 10_000,
        scoreMilli,
        isCutGrade: true,
        name: `Nota de Corte ${n}`,
      });
    const out = render({
      grades: configured({
        gradingPeriods: [c1, c2, c3],
        evaluations: [direct(1, c1.id, 3200), direct(2, c2.id, 4500), direct(3, c3.id, 4000)],
        summary: summary({
          complete: true,
          currentMilli: 3910,
          currentPasses: true,
          evaluatedWeightUnits: 100_000_000,
          remainingWeightUnits: 0,
          undefinedWeightUnits: 0,
          required: { status: 'SECURED' },
        }),
      }),
    });
    expect(out).toMatch(/data-testid="accumulated-grade"[^>]*>3\.9</); // NOT 1.4
    expect(out).toContain('/ 5.0');
    expect(out).toContain('3 de 3 cortes con nota');
    expect(out).toContain('Objetivo para aprobar');
    expect(out).toContain('Calificado 100 %');
    expect(out).toContain('Pendiente 0 %');
    expect(out).toContain('Aporta a la definitiva: 0.96');
    expect(out).toContain('Aporta a la definitiva: 1.35');
    expect(out).toContain('Aporta a la definitiva: 1.60');
    expect(out).not.toContain('¿Cuánto necesito?'); // nothing left to grade
    expect(out).not.toContain('Estimación');
    expect(out).not.toContain('Peso:'); // no internal evaluation weights
    expect(out).not.toContain('Agregar evaluación a');
    expect(out).not.toMatch(/Nombre/);
  });

  it('a single grade of 100 %: one card "Nota final", register 4.6 → 4.6 / 5.0, fully graded', () => {
    const c = cut(1, 10_000, 'Nota final');
    const pending = render({
      grades: configured({
        gradingPeriods: [c],
        evaluations: [],
        summary: summary({
          complete: true,
          currentMilli: null,
          currentPasses: null,
          evaluatedWeightUnits: 0,
          remainingWeightUnits: 100_000_000,
        }),
      }),
    });
    expect(pending).toContain('Nota final');
    expect(pending).toContain('100 % de la nota final');
    expect(pending).toContain('Pendiente');
    expect(pending).toContain('aria-label="Registrar nota de Nota final"');
    const graded = render({
      grades: configured({
        gradingPeriods: [c],
        evaluations: [
          evaluation(1, c.id, {
            periodShareBp: 10_000,
            scoreMilli: 4600,
            isCutGrade: true,
            name: 'Nota de Nota final',
          }),
        ],
        summary: summary({
          complete: true,
          currentMilli: 4600,
          evaluatedWeightUnits: 100_000_000,
          remainingWeightUnits: 0,
          required: { status: 'SECURED' },
        }),
      }),
    });
    expect(graded).toMatch(/data-testid="accumulated-grade"[^>]*>4\.6</);
    expect(graded).toContain('/ 5.0');
    expect(graded).toContain('1 de 1 corte con nota');
    expect(graded).toContain('Calificado 100 %');
    expect(graded).toContain('Pendiente 0 %');
    expect(graded).not.toContain('¿Cuánto necesito?');
  });

  it('a cut broken down into evaluations keeps the detailed rows, with their name and weight', () => {
    const c1 = cut(1, 3000);
    const out = render({
      grades: configured({
        gradingPeriods: [c1, cut(2, 7000)],
        evaluations: [
          evaluation(1, c1.id, {
            scoreMilli: 4500,
            rawEarnedMilli: 18_000,
            rawMaxMilli: 20_000,
            activityId: U(200),
          }),
          evaluation(2, c1.id),
        ],
        summary: summary({ complete: true }),
      }),
      activities: [{ id: U(200), title: 'Entrega taller' } as Activity],
    });
    expect(out).toContain('Peso: 50 % del corte');
    expect(out).toContain('18 / 20'); // the points, next to the canonical score
    expect(out).toContain('aria-label="Nota: 4.5"');
    expect(out).toContain('Actividad: Entrega taller');
    expect(out).toContain('Registrar nota de Evaluación 2'); // a pending one can be graded in one tap
    expect(out).toContain('aria-label="Agregar evaluación a Corte 1"');
    expect(out).not.toContain('Subtotal'); // one evaluation is still pending: no honest subtotal
  });

  it('a cut whose evaluations are all graded and add up to 100 % shows its subtotal and what it adds', () => {
    const c1 = cut(1, 10_000);
    const out = render({
      grades: configured({
        gradingPeriods: [c1],
        evaluations: [
          evaluation(1, c1.id, { scoreMilli: 4000 }),
          evaluation(2, c1.id, { scoreMilli: 3000 }),
        ],
        summary: summary(),
      }),
    });
    expect(out).toContain('Subtotal: 3.5');
    expect(out).toContain('Aporta a la definitiva: 3.50');
  });

  it('nothing graded: neither number pretends to exist', () => {
    const out = render({ grades: configured() });
    expect(out).toMatch(/data-testid="accumulated-grade"[^>]*>Sin notas todavía</);
    expect(out).toMatch(/data-testid="current-grade"[^>]*>Sin notas todavía</);
    expect(out).toContain('0 de 3 cortes con nota');
  });

  it('only a cut described to less than 100 % is an estimate, and it names the cut', () => {
    const c1 = cut(1, 10_000, 'Corte único');
    const out = render({
      grades: configured({
        gradingPeriods: [c1],
        evaluations: [evaluation(1, c1.id, { periodShareBp: 7000, scoreMilli: 4000 })],
        summary: summary({ complete: false }),
      }),
    });
    expect(out).toContain('Estimación: falta definir parte del peso de Corte único.');
  });

  it('secured and impossible, in the words the student reads', () => {
    expect(
      render({ grades: configured({ summary: summary({ required: { status: 'SECURED' } }) }) }),
    ).toContain('el objetivo está asegurado aunque el resto quede en el mínimo de la escala');
    expect(
      render({
        grades: configured({
          summary: summary({ required: { status: 'IMPOSSIBLE' }, currentPasses: false }),
        }),
      }),
    ).toContain('Con el peso restante no alcanza para llegar a la nota objetivo.');
  });

  it('an archived study is still readable, and says so', () => {
    const out = render({
      track: track({ status: 'ARCHIVED' }),
      grades: configured({ summary: summary() }),
    });
    expect(out).toContain('Este estudio está archivado');
    expect(out).toContain('Nota acumulada');
  });

  it('never shows the internals', () => {
    const out = render({
      grades: configured({
        evaluations: [evaluation(1, U(11), { scoreMilli: 4300 })],
        summary: summary(),
      }),
    });
    for (const internal of [
      'milli',
      'Milli',
      'basis',
      'GradingProfile',
      'GradingPeriod',
      '4300',
      '5000',
    ]) {
      expect(out, internal).not.toContain(internal);
    }
  });

  it('long names wrap instead of truncating', () => {
    const long =
      'Evaluación con un nombre larguísimo que no cabe en una sola línea de un teléfono de 320 píxeles';
    const c1 = cut(
      1,
      10_000,
      'Un corte con un nombre larguísimo que también debe partirse en varias líneas',
    );
    const out = render({
      grades: configured({
        gradingPeriods: [c1],
        evaluations: [evaluation(1, c1.id, { name: long })],
      }),
    });
    expect(out).toContain(long);
    expect(out.match(/break-words/g)!.length).toBeGreaterThanOrEqual(3);
    expect(out).not.toContain('truncate');
  });

  it('a subject that is not yours looks exactly like one that does not exist (friendly, no onboarding)', () => {
    // The API answers both with the same 404, and the page treats any 404 of the subject or its grades the same way.
    expect(isNotFound(new ApiRequestError(404, 'NOT_FOUND', 'Asignatura no encontrada.'))).toBe(
      true,
    );
    expect(isNotFound(new ApiRequestError(500, 'X', 'x'))).toBe(false);
    expect(isNotFound(null)).toBe(false);
    const out = renderToStaticMarkup(
      <StaticRouter location="/subjects/x/grades">
        <GradesNotFound />
      </StaticRouter>,
    );
    expect(out).toContain('No encontramos esa asignatura.');
    expect(out).toContain('href="/subjects"');
    expect(out).not.toContain('/onboarding');
  });
});

describe('the configuration is the period’s, not the subject’s', () => {
  const cached = (c: QueryClient, subjectId: string, periodId: string) =>
    c.setQueryData(subjectGradesKey(subjectId), { subjectId, periodId });
  // exactly what the setup / scale / cut mutations do
  const refreshPeriod = (c: QueryClient, periodId: string) =>
    c.invalidateQueries({
      queryKey: SUBJECT_GRADES_KEY,
      predicate: (q) => isGradesOfPeriod(q.state.data, periodId),
    });

  it('changing the configuration of P1 refreshes the subjects of P1 only — not those of another period or study', async () => {
    const c = new QueryClient();
    cached(c, U(3), U(51)); // subject A, period P1
    cached(c, U(4), U(51)); // subject B, period P1
    cached(c, U(5), U(52)); // subject C, period P2
    await refreshPeriod(c, U(51));
    expect(c.getQueryState(subjectGradesKey(U(3)))!.isInvalidated).toBe(true);
    expect(c.getQueryState(subjectGradesKey(U(4)))!.isInvalidated).toBe(true);
    expect(c.getQueryState(subjectGradesKey(U(5)))!.isInvalidated).toBe(false);
  });

  it('an evaluation refreshes only its own subject', async () => {
    const d = new QueryClient();
    cached(d, U(3), U(51));
    cached(d, U(4), U(51));
    await d.invalidateQueries({ queryKey: subjectGradesKey(U(3)) });
    expect(d.getQueryState(subjectGradesKey(U(3)))!.isInvalidated).toBe(true);
    expect(d.getQueryState(subjectGradesKey(U(4)))!.isInvalidated).toBe(false);
  });
});

describe('the dialogs', () => {
  const wrap = (node: React.ReactNode) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
    );

  it('without a scale the setup starts with it (friendly presets, no internals) and says it is shared', () => {
    const out = wrap(
      <SetupDialog
        subjectId={SUBJECT_ID}
        subjectName="Farmacología"
        hasScale={false}
        studyType="UNIVERSITY"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(out).toContain('0.0–5.0 · aprueba con 3.0');
    expect(out).toContain('0–100 · aprueba con 60');
    expect(out).toContain('Personalizada');
    expect(out).toContain('La escala se comparte con las demás materias de este periodo.');
    expect(out).toContain('aria-labelledby');
  });

  it('with the scale already there it goes straight to "¿Cómo se divide {materia}?", with presets that are only helps', () => {
    const out = wrap(
      <SetupDialog
        subjectId={SUBJECT_ID}
        subjectName="Anatomía"
        hasScale
        studyType="UNIVERSITY"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(out).not.toContain('¿Cómo se califica?'); // the scale is not asked again
    expect(out).toContain('¿Cómo se divide Anatomía? (Cortes)');
    expect(out).toContain('30 % / 30 % / 40 %');
    expect(out).toContain('Una sola nota (100 %)');
    expect(out).toContain('Personalizar');
    expect(out).toContain('solo vale para Anatomía');
  });

  it('the presets follow the kind of study, and any study offers a single grade', () => {
    const school = wrap(
      <SetupDialog
        subjectId={SUBJECT_ID}
        subjectName="Matemáticas"
        hasScale
        studyType="SCHOOL"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(school).toContain('Configurar notas · Periodos de evaluación');
    expect(school).toContain('25 % / 25 % / 25 % / 25 %');
    expect(school).toContain('Una sola nota (100 %)');
    const other = wrap(
      <SetupDialog
        subjectId={SUBJECT_ID}
        subjectName="Módulo 1"
        hasScale
        studyType="OTHER_ACADEMIC"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(other).toContain('Configurar notas · Etapas');
    expect(other).toContain('Una sola nota (100 %)');
    expect(other).not.toContain('30 %');
  });

  it('removing an evaluation asks first and says the activity stays', () => {
    const out = wrap(
      <ConfirmRemoveDialog
        kind="evaluation"
        id={U(1)}
        name="Parcial 1"
        subjectId={SUBJECT_ID}
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(out).toContain('¿Eliminar Parcial 1?');
    expect(out).toContain('La actividad enlazada no se borra.');
    expect(out).toContain('Cancelar');
  });
});
