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
import { periodsKey } from '../academic/useAcademic';
import { ApiRequestError } from '../api/client';
import { SUBJECT_GRADES_KEY, subjectGradesKey, subjectKey } from '../grading/useGrading';
import { studyTracksKey } from '../studyTracks/useStudyTracks';
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

function render(seed: Seed = {}, c = new QueryClient()) {
  const p = seed.period ?? period();
  c.setQueryData(subjectKey(SUBJECT_ID), subject());
  c.setQueryData(periodsKey, [p]);
  c.setQueryData(studyTracksKey, seed.track === null ? [] : [seed.track ?? track()]);
  c.setQueryData(['activities', { subjectId: SUBJECT_ID }], seed.activities ?? []);
  c.setQueryData(subjectGradesKey(SUBJECT_ID), {
    subjectId: SUBJECT_ID,
    periodId: PERIOD_ID,
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

  it('without a scale: says the configuration is shared with the other subjects, with one clear action', () => {
    const out = render();
    expect(out).toContain('Configura cómo califican esta materia');
    expect(out).toContain(
      'La escala y los cortes se comparten con las demás materias de este periodo.',
    );
    expect(out).toContain('Configurar notas');
    expect(out).not.toContain('Nota actual');
  });

  it('uses the words of the study: Periodos de evaluación (school), Etapas (other study)', () => {
    expect(render({ track: track({ type: 'SCHOOL' }) })).toContain(
      'La escala y los periodos de evaluación se comparten',
    );
    expect(render({ track: track({ type: 'OTHER_ACADEMIC' }) })).toContain(
      'La escala y las etapas se comparten',
    );
  });

  it('a period without a study cannot be graded: it says why and points to Mis estudios', () => {
    const out = render({ period: period({ studyTrackId: null }), track: null });
    expect(out).toContain('Las notas necesitan un estudio');
    expect(out).toContain('href="/settings/studies"');
    expect(out).not.toContain('Configurar notas');
  });

  it('configured and empty: "Sin notas todavía", the pass mark, every cut with its weight and an add action', () => {
    const out = render({ grades: configured() });
    expect(out).toContain('Sin notas todavía');
    expect(out).toContain('Aprobatoria: 3.0');
    expect(out).toContain('30 % de la nota final');
    expect(out).toContain('40 % de la nota final');
    expect(out).toContain('Aún no hay evaluaciones aquí.');
    expect(out).toContain('aria-label="Agregar evaluación a Corte 3"');
  });

  it('with evaluations: current grade, neutral status, what is needed and the rows', () => {
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
        summary: summary(),
      }),
      activities: [{ id: U(200), title: 'Entrega taller' } as Activity],
    });
    expect(out).toContain('4.3');
    expect(out).toContain('Por ahora estás por encima de la nota mínima.');
    expect(out).toContain('Necesitas aproximadamente 2.3 en lo que falta.');
    expect(out).toContain('¿Cuánto necesito?');
    expect(out).toContain('Peso: 50 % del corte');
    expect(out).toContain('18 / 20'); // the points, next to the canonical score
    expect(out).toContain('aria-label="Nota: 4.5"');
    expect(out).toContain('Actividad: Entrega taller');
    expect(out).toContain('Registrar nota de Evaluación 2'); // a pending one can be graded in one tap
    expect(out).toContain('Pendiente');
    expect(out).not.toContain('Subtotal'); // one evaluation is still pending: no honest subtotal
  });

  it('a cut whose evaluations are all graded and add up to 100 % shows its subtotal', () => {
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
  });

  it('incomplete weights are marked as an estimate; complete ones are not', () => {
    const out = render({ grades: configured({ summary: summary({ complete: false }) }) });
    expect(out).toContain('Estimación: faltan pesos por definir.');
    expect(render({ grades: configured({ summary: summary() }) })).not.toContain('Estimación');
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
    expect(
      render({ grades: configured({ summary: summary({ currentPasses: false }) }) }),
    ).toContain('Por ahora estás por debajo de la nota mínima.');
  });

  it('an archived study is still readable, and says so', () => {
    const out = render({
      track: track({ status: 'ARCHIVED' }),
      grades: configured({ summary: summary() }),
    });
    expect(out).toContain('Este estudio está archivado');
    expect(out).toContain('Nota actual');
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
  it('changing it refreshes the grades of EVERY cached subject; an evaluation only its own subject', async () => {
    const c = new QueryClient();
    c.setQueryData(subjectGradesKey(U(3)), { a: 1 });
    c.setQueryData(subjectGradesKey(U(4)), { b: 2 });
    await c.invalidateQueries({ queryKey: SUBJECT_GRADES_KEY }); // what setup / scale / cut mutations do
    expect(c.getQueryState(subjectGradesKey(U(3)))!.isInvalidated).toBe(true);
    expect(c.getQueryState(subjectGradesKey(U(4)))!.isInvalidated).toBe(true);

    const d = new QueryClient();
    d.setQueryData(subjectGradesKey(U(3)), { a: 1 });
    d.setQueryData(subjectGradesKey(U(4)), { b: 2 });
    await d.invalidateQueries({ queryKey: subjectGradesKey(U(3)) }); // what an evaluation mutation does
    expect(d.getQueryState(subjectGradesKey(U(3)))!.isInvalidated).toBe(true);
    expect(d.getQueryState(subjectGradesKey(U(4)))!.isInvalidated).toBe(false);
  });
});

describe('the dialogs', () => {
  const wrap = (node: React.ReactNode) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
    );

  it('the setup starts with the scale (friendly presets, no internals) and shares the configuration', () => {
    const out = wrap(
      <SetupDialog
        periodId={PERIOD_ID}
        studyType="UNIVERSITY"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(out).toContain('0.0–5.0 · aprueba con 3.0');
    expect(out).toContain('0–100 · aprueba con 60');
    expect(out).toContain('Personalizada');
    expect(out).toContain('se comparten con las demás materias de este periodo');
    expect(out).toContain('aria-labelledby');
  });

  it('the school setup talks about periodos de evaluación', () => {
    const out = wrap(
      <SetupDialog periodId={PERIOD_ID} studyType="SCHOOL" onClose={() => {}} onDone={() => {}} />,
    );
    expect(out).toContain('los periodos de evaluación');
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
