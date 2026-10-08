import { QueryError } from '../../components/QueryError';
import { formatDuration } from '@planner/core';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';
import { useWorkload } from '../../insights/useInsights';
import { busiestText, plural, totalsLine } from '../progress/WorkloadDetail';

const link =
  'inline-flex min-h-11 items-center text-sm font-medium text-accent-ink underline underline-offset-4';

/**
 * Compact summary of the CURRENT week (Monday to Sunday): how many commitments are registered and how many hours
 * the agenda holds. Descriptive only: it states what is registered, it does not judge the week or advise anything.
 * The detail lives in /progress and the agenda in /calendar.
 */
export function WeekCard() {
  const workload = useWorkload();

  return (
    <Card as="section" aria-labelledby="week-title" className="flex flex-col gap-2 p-4">
      <h2 id="week-title" className="text-section-title">
        Esta semana
      </h2>

      {workload.isPending && <p role="status">Cargando tu semana…</p>}
      <QueryError query={workload} title="No se pudo cargar la semana" />

      {workload.data &&
        (workload.data.totals.totalCommitments === 0 ? (
          <p>No tienes compromisos registrados esta semana.</p>
        ) : (
          <>
            <p className="text-2xl font-semibold text-primary">
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
    </Card>
  );
}
