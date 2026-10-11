import { DEFAULT_TIMEZONE, formatDateOnly, type DashboardActivity } from '@planner/core';
import { Link } from 'react-router';
import { useAttention } from '../attention/useAttention';
import { useMe } from '../auth/useAuth';
import { QueryError } from '../components/QueryError';
import { buttonStyles } from '../components/ui/buttonStyles';
import { Card } from '../components/ui/Card';
import { useDashboard } from '../dashboard/useDashboard';
import { useNow } from '../lib/useNow';
import { AmbientMood } from './dashboard/AmbientTone';
import { ClassesToday } from './dashboard/ClassesToday';
import { HomeSkeleton } from './dashboard/HomeSkeleton';
import { NoActivities, NoSubjects } from './dashboard/EmptyStates';
import { DueSection } from './dashboard/DueSection';
import { NextDueCard } from './dashboard/NextDueCard';
import { ProgressCard } from './dashboard/ProgressCard';
import { SummaryTiles } from './dashboard/SummaryTiles';
import { AttentionCard } from './attention/AttentionCard';
import { WeekCard } from './dashboard/WeekCard';
import { RadarCard } from './radar/RadarCard';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { QuickCapture } from './quickCapture/QuickCapture';
import { RemindersPanel } from './reminders/RemindersPanel';

/**
 * Home. Everything shown is derived by GET /api/dashboard for the current period; nothing is stored here.
 *
 * Hierarchy, in the order a student asks: "what do I do NOW?" (the hero, then today), "how am I doing?" (counters,
 * progress, capturing something new) and "what comes next?" (Radar, next deliveries, the week). Secondary
 * destinations stay at the bottom with low weight.
 */
export function DashboardPage() {
  const user = useMe().data;
  const dashboard = useDashboard();
  const now = useNow();

  if (dashboard.isPending) return <HomeSkeleton />;
  if (!dashboard.data) {
    return <QueryError query={dashboard} title="No se pudo cargar tu panel" />;
  }

  const d = dashboard.data;
  const timeZone = user?.timezone ?? DEFAULT_TIMEZONE;
  const hasData = d.subjectCount > 0 && d.summary.total > 0;

  // The highlighted next activity is not repeated in the lists below it.
  const nextId = d.nextDue?.id;
  const today = d.today.filter((a) => a.id !== nextId);
  const upcoming = d.upcoming.filter((a) => a.id !== nextId);

  // Two columns from 1024 px: "what to do now" on the left and "how am I doing" on the right, with what comes next under
  // the left one. In the DOM the three groups follow the phone's reading order (now, how am I doing, what comes next), so
  // keyboard and screen-reader order never disagree with what is on screen; only the grid moves them.
  const side = hasData || d.subjectCount > 0;
  const columns = side
    ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(19rem,25rem)] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-6'
    : 'lg:max-w-3xl';

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      {hasData && (
        <AmbientMood
          percent={d.progress.percent}
          total={d.summary.total}
          overdue={d.summary.overdue}
        />
      )}
      <header className="animate-rise">
        <h1 className="text-display break-words lg:text-[2.5rem] lg:leading-[3rem]">
          {d.greeting}, {user?.name}
        </h1>
        {d.period && (
          <p className="mt-0.5 text-sm text-muted-foreground break-words">
            {d.period.name} · {formatDateOnly(d.period.startDate)} –{' '}
            {formatDateOnly(d.period.endDate)}
          </p>
        )}
      </header>

      <QueryError query={dashboard} title="No se pudo cargar tu panel" />

      <RemindersPanel timeZone={timeZone} now={now} />

      <div className={`flex flex-col gap-5 ${columns}`}>
        {/* NOW */}
        <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-1">
          {hasData && <AttentionCard timeZone={timeZone} now={now} />}

          {d.classesToday.length > 0 && (
            <ClassesToday classes={d.classesToday} timeZone={timeZone} />
          )}

          {d.subjectCount === 0 && <NoSubjects />}
          {d.subjectCount > 0 && d.summary.total === 0 && <NoActivities />}

          {hasData && d.overdue.length > 0 && (
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
                    <Link
                      to="/activities?overdue=true"
                      className="font-medium text-accent-ink underline underline-offset-4"
                    >
                      Ver todas las vencidas
                    </Link>
                  </p>
                )
              }
            />
          )}
          {hasData && today.length > 0 && (
            <DueSection title="Para hoy" items={today} timeZone={timeZone} now={now} />
          )}
        </div>

        {/* HOW AM I DOING */}
        {side && (
          <div className="flex flex-col gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {hasData && (
              <>
                <SummaryTiles summary={d.summary} />
                <ProgressCard progress={d.progress} />
              </>
            )}

            {d.subjectCount > 0 && (
              <Card variant="accent" className="flex flex-col gap-3 p-4 pl-5">
                <QuickCapture />
                <p className="text-sm text-muted-foreground">
                  ¿Tienes un mensaje del profesor? Pégalo aquí.{' '}
                  <Link
                    to="/inbox"
                    className="font-medium text-accent-ink underline underline-offset-4"
                  >
                    Interpretar mensaje
                  </Link>
                </p>
              </Card>
            )}

            {hasData && <RadarCard />}
          </div>
        )}

        {/* WHAT COMES NEXT */}
        {hasData && (
          <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-2 lg:self-start">
            <NextDue activity={d.nextDue} timeZone={timeZone} now={now} />
            {upcoming.length > 0 && (
              <DueSection
                title="Próximas entregas"
                items={upcoming}
                timeZone={timeZone}
                now={now}
              />
            )}
            <WeekCard />

            <nav aria-label="Accesos rápidos" className="flex flex-wrap gap-2">
              <Link to="/activities?action=create" className={buttonStyles({ size: 'sm' })}>
                Nueva actividad
              </Link>
              <Link to="/subjects?action=create" className={buttonStyles({ size: 'sm' })}>
                Nueva asignatura
              </Link>
            </nav>
          </div>
        )}
      </div>

      <InstallPrompt />
    </div>
  );
}

/** "Próxima entrega": when the hero already shows that very activity it shrinks to one quiet line. */
function NextDue({
  activity,
  timeZone,
  now,
}: {
  activity: DashboardActivity | null;
  timeZone: string;
  now: Date;
}) {
  const attention = useAttention();
  // Until the hero is known the card would appear and then collapse into a line (a flash, and a node swapped under the
  // student's eyes): wait for the answer, and show the card as soon as it is known (or if it fails).
  if (attention.isPending) return null;
  // The hero opens on the first of its activities (the one due soonest): that is the one it already shows.
  const heroId = (attention.data?.upcoming[0] ?? attention.data?.recommendation)?.activity.id;
  const quiet = activity !== null && activity.id === heroId;
  return <NextDueCard activity={activity} timeZone={timeZone} now={now} quiet={quiet} />;
}
