import { formatDuration } from '@planner/core';
import { Link } from 'react-router';
import { useWorkload } from '../../insights/useInsights';
import { busiestText, plural, totalsLine } from '../progress/WorkloadDetail';

const link =
  'inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * Compact summary of the CURRENT week (Monday to Sunday): how many commitments are registered and how many hours
 * the agenda holds. Descriptive only: it states what is registered, it does not judge the week or advise anything.
 * The detail lives in /progress and the agenda in /calendar.
 */
export function WeekCard() {
  const workload = useWorkload();

  return (
    <section
      aria-labelledby="week-title"
      className="flex flex-col gap-2 rounded-lg border border-slate-300 p-4"
    >
      <h2 id="week-title" className="text-lg font-semibold">
        Esta semana
      </h2>

      {workload.isPending && <p role="status">Cargando tu semana…</p>}
      {workload.isError && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-2">No se pudo cargar la semana: {workload.error.message}</p>
          <button
            type="button"
            onClick={() => workload.refetch()}
            className="min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100"
          >
            Reintentar
          </button>
        </div>
      )}

      {workload.data &&
        (workload.data.totals.totalCommitments === 0 ? (
          <p>No tienes compromisos registrados esta semana.</p>
        ) : (
          <>
            <p className="text-3xl font-semibold">
              {plural(workload.data.totals.totalCommitments, 'compromiso', 'compromisos')}
            </p>
            {workload.data.totals.scheduledMinutes > 0 && (
              <p>{formatDuration(workload.data.totals.scheduledMinutes)} programadas</p>
            )}
            {workload.data.busiestDay && (
              <p className="text-sm">
                Día con más compromisos: <strong>{busiestText(workload.data.busiestDay)}</strong>
              </p>
            )}
            <p className="text-sm text-slate-700">{totalsLine(workload.data.totals)}</p>
          </>
        ))}

      {workload.data && (
        <>
          <p className="text-sm text-slate-600">Se basa solo en lo que has registrado.</p>
          <div className="flex flex-wrap gap-x-4">
            <Link to={`/calendar?week=${workload.data.week.from}`} className={link}>
              Ver semana
            </Link>
            <Link to={`/progress?week=${workload.data.week.from}`} className={link}>
              Ver detalle por día
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
