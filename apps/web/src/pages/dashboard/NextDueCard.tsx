import { dueRelativeLabel, formatDue, type DashboardActivity } from '@planner/core';
import { Card } from '../../components/ui/Card';

interface Props {
  activity: DashboardActivity | null;
  timeZone: string;
  now: Date;
  /** The hero above already shows this very activity: say it in one quiet line instead of a second card. */
  quiet?: boolean;
}

/** The first open, not-yet-due activity by deadline. Date only: no scoring or recommendation. */
export function NextDueCard({ activity, timeZone, now, quiet = false }: Props) {
  if (activity && quiet) {
    return (
      <section aria-labelledby="next-due-title" className="px-1 text-sm text-muted-foreground">
        <h2 id="next-due-title" className="inline font-semibold text-foreground">
          Próxima entrega
        </h2>
        <span aria-hidden="true"> · </span>
        <span className="break-words">
          {activity.title} · {activity.subject.name} · {formatDue(activity, timeZone)} ·{' '}
          {dueRelativeLabel(activity, now, timeZone)}
        </span>
      </section>
    );
  }

  return (
    <Card as="section" aria-labelledby="next-due-title" className="p-4">
      <h2
        id="next-due-title"
        className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Próxima entrega
      </h2>
      {activity ? (
        <div className="mt-1 min-w-0">
          <p className="text-card-title break-words">{activity.title}</p>
          <p className="text-muted-foreground break-words">{activity.subject.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-foreground">
            <span>{formatDue(activity, timeZone)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold">{dueRelativeLabel(activity, now, timeZone)}</span>
          </p>
        </div>
      ) : (
        <p className="mt-1 text-muted-foreground">No tienes entregas próximas.</p>
      )}
    </Card>
  );
}
