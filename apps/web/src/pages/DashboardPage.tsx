import { DEFAULT_TIMEZONE, formatDateOnly } from '@planner/core';
import { Link } from 'react-router';
import { useMe } from '../auth/useAuth';
import { useDashboard } from '../dashboard/useDashboard';
import { useNow } from '../lib/useNow';
import { NoActivities, NoSubjects } from './dashboard/EmptyStates';
import { DueSection } from './dashboard/DueSection';
import { NextDueCard } from './dashboard/NextDueCard';
import { ProgressCard } from './dashboard/ProgressCard';
import { SummaryTiles } from './dashboard/SummaryTiles';

const quickLink =
  'inline-flex min-h-11 items-center rounded-md border border-slate-400 px-4 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/** Home. Everything shown is derived by GET /api/dashboard for the current period; nothing is stored here. */
export function DashboardPage() {
  const user = useMe().data;
  const dashboard = useDashboard();
  const now = useNow();

  if (dashboard.isPending) return <p role="status">Cargando tu panel…</p>;
  if (dashboard.isError) {
    return (
      <div role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
        <p className="mb-2">No se pudo cargar tu panel: {dashboard.error.message}</p>
        <button
          type="button"
          onClick={() => dashboard.refetch()}
          className="min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const d = dashboard.data;
  const timeZone = user?.timezone ?? DEFAULT_TIMEZONE;
  const hasData = d.subjectCount > 0 && d.summary.total > 0;

  // The highlighted next activity is not repeated in the lists below it.
  const nextId = d.nextDue?.id;
  const today = d.today.filter((a) => a.id !== nextId);
  const upcoming = d.upcoming.filter((a) => a.id !== nextId);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold break-words">
          {d.greeting}, {user?.name}
        </h1>
        {d.period && (
          <p className="text-sm text-slate-600 break-words">
            {d.period.name} · {formatDateOnly(d.period.startDate)} –{' '}
            {formatDateOnly(d.period.endDate)}
          </p>
        )}
      </header>

      {d.subjectCount === 0 && <NoSubjects />}
      {d.subjectCount > 0 && d.summary.total === 0 && <NoActivities />}

      {hasData && (
        <>
          <SummaryTiles summary={d.summary} />
          <NextDueCard activity={d.nextDue} timeZone={timeZone} now={now} />

          {d.overdue.length > 0 && (
            <DueSection
              title="Vencidas"
              items={d.overdue}
              timeZone={timeZone}
              now={now}
              overdue
              footer={
                d.summary.overdue > d.overdue.length && (
                  <p className="text-sm">
                    Mostrando {d.overdue.length} de {d.summary.overdue}.{' '}
                    <Link to="/activities?overdue=true" className="font-medium underline">
                      Ver todas las vencidas
                    </Link>
                  </p>
                )
              }
            />
          )}
          {today.length > 0 && (
            <DueSection title="Para hoy" items={today} timeZone={timeZone} now={now} />
          )}
          {upcoming.length > 0 && (
            <DueSection title="Próximas entregas" items={upcoming} timeZone={timeZone} now={now} />
          )}

          <ProgressCard progress={d.progress} />

          <nav aria-label="Accesos rápidos" className="flex flex-wrap gap-2">
            <Link to="/activities?action=create" className={quickLink}>
              Nueva actividad
            </Link>
            <Link to="/subjects?action=create" className={quickLink}>
              Nueva asignatura
            </Link>
          </nav>
        </>
      )}
    </div>
  );
}
