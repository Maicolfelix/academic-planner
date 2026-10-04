import {
  SCHEDULE_BLOCK_TYPE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  toLocalParts,
  weekdayOf,
  type ScheduleOccurrence,
} from '@planner/core';
import { dayNumber, timeRange } from './format';
import { layoutDay, minutesOf } from './layoutDay';

const HOUR_PX = 48;

interface Props {
  days: string[];
  occurrences: ScheduleOccurrence[];
  timeZone: string;
  today: string;
  onOpen: (occurrence: ScheduleOccurrence) => void;
}

/** Desktop view: Monday to Sunday side by side, blocks positioned by their hour. */
export function WeekGrid({ days, occurrences, timeZone, today, onOpen }: Props) {
  const items = occurrences.map((o) => ({
    o,
    startMin: minutesOf(toLocalParts(o.startAt, timeZone).time),
    endMin: minutesOf(toLocalParts(o.endAt, timeZone).time),
  }));

  // Show at least 07:00–20:00, and widen it only when a block falls outside.
  const firstHour = Math.min(7, ...items.map((i) => Math.floor(i.startMin / 60)));
  const lastHour = Math.max(20, ...items.map((i) => Math.ceil(i.endMin / 60)));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const height = hours.length * HOUR_PX;

  return (
    <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] text-sm">
      <div />
      {days.map((day) => (
        <div
          key={day}
          aria-current={day === today ? 'date' : undefined}
          className={`border-b border-l border-slate-300 px-1 py-2 text-center font-medium ${
            day === today ? 'bg-slate-100' : ''
          }`}
        >
          <span>{WEEKDAY_SHORT_LABELS[weekdayOf(day)]}</span>{' '}
          <span className={day === today ? 'font-bold underline' : ''}>{dayNumber(day)}</span>
          {day === today && <span className="sr-only"> (hoy)</span>}
        </div>
      ))}

      <div className="relative" style={{ height }} aria-hidden="true">
        {hours.map((h) => (
          <span
            key={h}
            style={{ top: (h - firstHour) * HOUR_PX }}
            className="absolute right-1 -translate-y-2 text-xs text-slate-600"
          >
            {h > firstHour && `${String(h).padStart(2, '0')}:00`}
          </span>
        ))}
      </div>

      {days.map((day) => {
        const placed = layoutDay(items.filter((i) => i.o.occurrenceDate === day));
        return (
          <div
            key={day}
            className="relative border-l border-slate-300"
            style={{
              height,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, #e2e8f0 ${HOUR_PX - 1}px, #e2e8f0 ${HOUR_PX}px)`,
            }}
          >
            {placed.map(({ o, startMin, endMin, lane, lanes }) => (
              <button
                key={`${o.blockId}-${o.startAt}`}
                type="button"
                onClick={() => onOpen(o)}
                aria-label={`${o.title}, ${WEEKDAY_LABELS[weekdayOf(o.occurrenceDate)]}, ${timeRange(o, timeZone).replace('–', ' a ')}${
                  o.hasConflict ? ', con choque de horario' : ''
                }`}
                style={{
                  top: ((startMin - firstHour * 60) / 60) * HOUR_PX,
                  height: Math.max(((endMin - startMin) / 60) * HOUR_PX - 2, 22),
                  left: `calc(${(lane * 100) / lanes}% + 1px)`,
                  width: `calc(${100 / lanes}% - 2px)`,
                  borderLeftColor: o.subject?.color ?? '#64748B',
                }}
                className={`absolute flex flex-col overflow-hidden rounded border border-l-4 bg-white p-1 text-left text-xs shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 ${
                  o.hasConflict ? 'border-red-700' : 'border-slate-300'
                }`}
              >
                {/* Side by side (lanes > 1) a block is ~70 px wide: keep only what fits; the full text is in its accessible name. */}
                <span className="truncate font-semibold">
                  {o.hasConflict && lanes > 1 && '⚠ '}
                  {o.title}
                </span>
                <span className={`truncate `}>{timeRange(o, timeZone)}</span>
                {lanes === 1 && (
                  <span className="truncate text-slate-700">
                    {SCHEDULE_BLOCK_TYPE_LABELS[o.type]}
                    {o.isRecurring && ' · semanal'}
                  </span>
                )}
                {o.hasConflict && lanes === 1 && (
                  <span className="truncate font-semibold text-red-800">⚠ Choque</span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
