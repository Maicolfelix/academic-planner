import { dueRelativeLabel, formatDue, type DashboardActivity } from '@planner/core';
import { Card } from '../../components/ui/Card';
import { IconTile } from '../../components/ui/IconTile';
import { CalendarIcon } from '../../components/ui/icons';

interface Props {
  activity: DashboardActivity | null;
  timeZone: string;
  now: Date;
  /** The study the activity comes from, when it is worth saying (see `originLabelOf`). */
  origin?: string | null;
}

/** The first open, not-yet-due activity by deadline. Date only: no scoring or recommendation. */
export function NextDueCard({ activity, timeZone, now, origin = null }: Props) {
  return (
    <Card as="section" aria-labelledby="next-due-title" className="p-4">
      <h2
        id="next-due-title"
        className="flex items-center gap-2.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
      >
        <IconTile>
          <CalendarIcon />
        </IconTile>
        Próxima entrega
      </h2>
      {activity ? (
        <div className="mt-1 min-w-0">
          <p className="text-card-title break-words">{activity.title}</p>
          <p className="text-muted-foreground break-words">
            {activity.subject?.name ?? 'Sin asignatura'}
            {origin && ` · ${origin}`}
          </p>
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
