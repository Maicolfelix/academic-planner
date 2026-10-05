import { QueryError } from '../components/QueryError';
import { addDays, formatDateOnly, formatDuration, isRealDateOnly } from '@planner/core';
import { Link, useSearchParams } from 'react-router';
import { useProgress, useWorkload } from '../insights/useInsights';
import { ProgressBar } from './progress/ProgressBar';
import { SubjectProgressList } from './progress/SubjectProgressList';
import { WorkloadDetail, busiestText, plural, totalsLine } from './progress/WorkloadDetail';

const secondary =
  'min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * Descriptive views of what the student registered: progress of the activities (general and per subject) and
 * the commitments of a week. It does not measure performance, productivity or stress, and it does not
 * recommend anything.
 */
export function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week');
  const week = weekParam && isRealDateOnly(weekParam) ? weekParam : undefined;
  const goTo = (date: string | null) => setParams(date ? { week: date } : {}, { replace: true });

  const progress = useProgress();
  const workload = useWorkload(week);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold">Progreso y carga semanal</h1>
        <p className="text-sm text-slate-700">
          Todo se calcula con lo que has registrado en la aplicación.
        </p>
      </header>

      <section aria-labelledby="progress-title" className="flex flex-col gap-3">
        <h2 id="progress-title" className="text-lg font-semibold">
          Progreso de actividades
        </h2>
        {progress.isPending && <p role="status">Cargando progreso…</p>}
        <QueryError query={progress} title="No se pudo cargar el progreso" />
        {progress.data && <ProgressContent data={progress.data} />}
      </section>

      <section aria-labelledby="workload-title" className="flex flex-col gap-3">
        <h2 id="workload-title" className="text-lg font-semibold">
          Carga semanal
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => workload.data && goTo(addDays(workload.data.week.from, -7))}
            disabled={!workload.data}
            className={secondary}
          >
            Semana anterior
          </button>
          <button type="button" onClick={() => goTo(null)} className={secondary}>
            Semana actual
          </button>
          <button
            type="button"
            onClick={() => workload.data && goTo(addDays(workload.data.week.from, 7))}
            disabled={!workload.data}
            className={secondary}
          >
            Semana siguiente
          </button>
        </div>
        {workload.isPending && <p role="status">Cargando la semana…</p>}
        <QueryError query={workload} title="No se pudo cargar la semana" />
        {workload.data && (
          <>
            <p className="font-medium">
              Semana del {formatDateOnly(workload.data.week.from)} al{' '}
              {formatDateOnly(workload.data.week.to)}
            </p>
            {workload.data.totals.totalCommitments === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4">
                No hay compromisos registrados en esta semana.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p>
                  Esta semana hay{' '}
                  <strong>
                    {plural(workload.data.totals.totalCommitments, 'compromiso', 'compromisos')}
                  </strong>{' '}
                  registrados
                  {workload.data.totals.scheduledMinutes > 0 && (
                    <>
                      {' '}
                      y <strong>
                        {formatDuration(workload.data.totals.scheduledMinutes)}
                      </strong>{' '}
                      programadas
                    </>
                  )}
                  .
                </p>
                <p className="text-sm text-slate-700">{totalsLine(workload.data.totals)}</p>
                {workload.data.busiestDay && (
                  <p className="text-sm">
                    Día con más compromisos:{' '}
                    <strong>{busiestText(workload.data.busiestDay)}</strong>
                  </p>
                )}
              </div>
            )}
            <WorkloadDetail workload={workload.data} />
            <p className="text-sm text-slate-700">
              Se basa solo en lo que has registrado: una actividad cuenta como un compromiso y no
              suma horas; las horas programadas son las de tu agenda.
            </p>
            <Link
              to={`/calendar?week=${workload.data.week.from}`}
              className="inline-flex min-h-11 items-center self-start text-sm font-medium underline"
            >
              Ver esta semana en la Agenda
            </Link>
          </>
        )}
      </section>

      <p>
        <Link
          to="/dashboard"
          className="inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}

function ProgressContent({ data }: { data: NonNullable<ReturnType<typeof useProgress>['data']> }) {
  const { general, subjects } = data;
  if (general.total === 0 && subjects.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-4">
        Aún no hay asignaturas ni actividades registradas en este periodo.
      </p>
    );
  }
  const text = `${general.completed} de ${general.total} actividades completadas`;
  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-slate-300 p-4">
        {general.total === 0 ? (
          <p>Sin actividades registradas</p>
        ) : (
          <>
            <p className="text-3xl font-semibold">{general.percentage}%</p>
            <ProgressBar
              percent={general.percentage}
              label="Progreso general de actividades"
              valueText={`${general.percentage}%, ${text}`}
            />
            <p>{text}</p>
            <p className="text-sm text-slate-700">
              {plural(general.pending, 'pendiente', 'pendientes')} · {general.inProgress} en proceso
              · {plural(general.overdue, 'vencida', 'vencidas')}
            </p>
          </>
        )}
        <p className="text-sm text-slate-600">
          Mide solo las actividades que has registrado en este periodo. Todas pesan lo mismo.
        </p>
      </div>
      <h3 className="sr-only">Por asignatura</h3>
      <SubjectProgressList subjects={subjects} />
    </>
  );
}
