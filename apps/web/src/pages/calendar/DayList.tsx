import {
  SCHEDULE_BLOCK_TYPE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  weekdayOf,
  type ScheduleOccurrence,
} from '@planner/core';
import { dayNumber, timeRange } from './format';

interface Props {
  days: string[];
  selected: string;
  today: string;
  occurrences: ScheduleOccurrence[];
  timeZone: string;
  onSelect: (day: string) => void;
  onOpen: (occurrence: ScheduleOccurrence) => void;
}

/**
 * Phone view: a 7-column grid is unreadable at 360 px, so the week becomes a row of day buttons and
 * the selected day's blocks as a list, with the time as the most prominent part of every row.
 */
export function DayList({ days, selected, today, occurrences, timeZone, onSelect, onOpen }: Props) {
  const ofDay = (day: string) => occurrences.filter((o) => o.occurrenceDate === day);
  const list = ofDay(selected);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Días de la semana" className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const count = ofDay(day).length;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={day === selected}
              aria-current={day === today ? 'date' : undefined}
              aria-label={`${WEEKDAY_LABELS[weekdayOf(day)]} ${dayNumber(day)}${
                day === today ? ' (hoy)' : ''
              }${count ? `, ${count} ${count === 1 ? 'bloque' : 'bloques'}` : ''}`}
              onClick={() => onSelect(day)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-control border px-0.5 py-1 text-xs transition-[transform,background-color,color,box-shadow] duration-(--duration-normal) ease-spring active:scale-95 ${
                day === selected
                  ? 'z-10 scale-105 border-primary bg-primary text-primary-foreground shadow-lift'
                  : 'border-border bg-surface text-foreground hover:bg-secondary'
              }`}
            >
              <span>{WEEKDAY_SHORT_LABELS[weekdayOf(day)]}</span>
              <span className={`text-base font-semibold ${day === today ? 'underline' : ''}`}>
                {dayNumber(day)}
              </span>
              <span aria-hidden="true" className="h-1.5 text-[10px] leading-none">
                {count > 0 && '●'}
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="text-lg font-semibold">
        {WEEKDAY_LABELS[weekdayOf(selected)]} {dayNumber(selected)}
        {selected === today && <span className="font-normal text-slate-600"> · hoy</span>}
      </h2>

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-4 text-slate-600">
          Sin bloques este día.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((o) => (
            <li key={`${o.blockId}-${o.startAt}`}>
              <button
                type="button"
                onClick={() => onOpen(o)}
                className={`flex w-full min-w-0 overflow-hidden rounded-lg border bg-white text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                  o.hasConflict ? 'border-red-700' : 'border-slate-300'
                }`}
              >
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: o.subject?.color ?? '#64748B' }}
                  className="w-2 shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
                  <span className="text-lg leading-tight font-semibold">
                    {timeRange(o, timeZone)}
                  </span>
                  <span className="font-medium break-words">{o.title}</span>
                  <span className="text-sm text-slate-700 break-words">
                    {SCHEDULE_BLOCK_TYPE_LABELS[o.type]}
                    {o.subject && ` · ${o.subject.name}`}
                    {o.isRecurring && ' · se repite cada semana'}
                  </span>
                  {o.hasConflict && (
                    <span className="text-sm font-semibold text-red-800">
                      ⚠ Choque de horario con otro bloque
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
