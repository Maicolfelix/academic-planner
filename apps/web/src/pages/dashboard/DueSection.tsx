import { dueRelativeLabel, formatDue, type DashboardActivity } from '@planner/core';
import { useId, type ReactNode } from 'react';
import { OverdueBadge } from '../activities/badges';

interface Props {
  title: string;
  items: DashboardActivity[];
  timeZone: string;
  now: Date;
  /** Marks every row with the "Vencida" badge (text + symbol, never color alone). */
  overdue?: boolean;
  /** Shown under the list, e.g. a link to the rest. */
  footer?: ReactNode;
  /** Wording of the time left; defaults to the calendar label ("Vence mañana"). */
  describe?: (a: DashboardActivity) => string;
}

/** A compact list of activities: title, subject, deadline and how far away it is. */
export function DueSection({
  title,
  items,
  timeZone,
  now,
  overdue = false,
  footer,
  describe = (a) => dueRelativeLabel(a, now, timeZone),
}: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((a) => (
          <li
            key={a.id}
            className="flex min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white"
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: a.subject.color }}
              className="w-1.5 shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
              <p className="font-medium break-words">{a.title}</p>
              <p className="text-sm text-slate-700 break-words">{a.subject.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
                <span>{formatDue(a, timeZone)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-medium">{describe(a)}</span>
                {overdue && <OverdueBadge />}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {footer}
    </section>
  );
}
