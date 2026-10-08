import { dueRelativeLabel, formatDue, type DashboardActivity } from '@planner/core';
import { useId, type ReactNode } from 'react';
import { Card } from '../../components/ui/Card';
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
      <h2 id={headingId} className="text-section-title">
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((a) => (
          <Card as="li" key={a.id} className="flex min-w-0 overflow-hidden">
            <span
              aria-hidden="true"
              style={{ backgroundColor: a.subject.color }}
              className="w-1.5 shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5">
              <p className="font-medium break-words">{a.title}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="break-words">{a.subject.name}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDue(a, timeZone)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-foreground">{describe(a)}</span>
                {overdue && <OverdueBadge />}
              </p>
            </div>
          </Card>
        ))}
      </ul>
      {footer}
    </section>
  );
}
