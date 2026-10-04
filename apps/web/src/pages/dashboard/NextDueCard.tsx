import { dueRelativeLabel, formatDue, type DashboardActivity } from '@planner/core';

interface Props {
  activity: DashboardActivity | null;
  timeZone: string;
  now: Date;
}

/** The first open, not-yet-due activity by deadline. Date only: no scoring or recommendation. */
export function NextDueCard({ activity, timeZone, now }: Props) {
  return (
    <section
      aria-labelledby="next-due-title"
      className="rounded-lg border-2 border-slate-900 bg-white p-4"
    >
      <h2
        id="next-due-title"
        className="text-sm font-semibold tracking-wide text-slate-600 uppercase"
      >
        Próxima entrega
      </h2>
      {activity ? (
        <div className="mt-1 min-w-0">
          <p className="text-xl font-semibold break-words">{activity.title}</p>
          <p className="text-slate-700 break-words">{activity.subject.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-slate-800">
            <span>{formatDue(activity, timeZone)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold">{dueRelativeLabel(activity, now, timeZone)}</span>
          </p>
        </div>
      ) : (
        <p className="mt-1 text-slate-700">No tienes entregas próximas.</p>
      )}
    </section>
  );
}
