import type { ScheduleOccurrence } from '@planner/core';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';
import { timeRange } from '../calendar/format';

interface Props {
  classes: ScheduleOccurrence[];
  timeZone: string;
}

/** Today's timetable, by start time. Compact: the full week lives in the Agenda. */
export function ClassesToday({ classes, timeZone }: Props) {
  return (
    <section aria-labelledby="classes-today-title" className="flex flex-col gap-2">
      <h2 id="classes-today-title" className="text-section-title">
        Clases de hoy
      </h2>
      <ul className="flex flex-col gap-2">
        {classes.map((c) => (
          <Card as="li" key={`${c.blockId}-${c.startAt}`} className="flex min-w-0 overflow-hidden">
            <span
              aria-hidden="true"
              style={{ backgroundColor: c.subject?.color ?? '#64748B' }}
              className="w-1.5 shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 p-3">
              <span className="font-semibold">{timeRange(c, timeZone)}</span>
              <span className="min-w-0 break-words">{c.title}</span>
              {c.hasConflict && (
                <span className="text-sm font-semibold text-red-800">⚠ Choque de horario</span>
              )}
            </div>
          </Card>
        ))}
      </ul>
      <p className="text-sm">
        <Link to="/calendar" className="font-medium text-accent-ink underline underline-offset-4">
          Ver la agenda de la semana
        </Link>
      </p>
    </section>
  );
}
