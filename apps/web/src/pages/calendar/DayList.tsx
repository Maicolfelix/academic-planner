import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TYPE_LABELS,
  SCHEDULE_BLOCK_TYPE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  formatClock,
  toLocalParts,
  weekdayOf,
  type Activity,
  type ScheduleOccurrence,
  type Subject,
} from '@planner/core';
import { agendaActivityLabel, type AgendaActivity } from './agendaActivities';
import { dayNumber, timeRange } from './format';
import { minutesOf } from './layoutDay';

interface Props {
  days: string[];
  selected: string;
  today: string;
  occurrences: ScheduleOccurrence[];
  activities: AgendaActivity[];
  subjects: ReadonlyMap<string, Subject>;
  timeZone: string;
  onSelect: (day: string) => void;
  onOpen: (occurrence: ScheduleOccurrence) => void;
  onOpenActivity: (activity: Activity) => void;
}

type Row =
  | { kind: 'block'; at: number; o: ScheduleOccurrence }
  | { kind: 'activity'; at: number; a: AgendaActivity };

/** "2 bloques, 1 actividad": what a day button says about its day. */
function countsLabel(blocks: number, activities: number): string {
  return [
    blocks > 0 ? `${blocks} ${blocks === 1 ? 'bloque' : 'bloques'}` : '',
    activities > 0 ? `${activities} ${activities === 1 ? 'actividad' : 'actividades'}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Phone view: a 7-column grid is unreadable at 360 px, so the week becomes a row of day buttons and
 * the selected day's blocks and activities as a list, with the time as the most prominent part of every row. The
 * activities with no hour come first, under "Sin hora".
 */
export function DayList({
  days,
  selected,
  today,
  occurrences,
  activities,
  subjects,
  timeZone,
  onSelect,
  onOpen,
  onOpenActivity,
}: Props) {
  const blocksOf = (day: string) => occurrences.filter((o) => o.occurrenceDate === day);
  const activitiesOf = (day: string) => activities.filter((a) => a.date === day);

  const untimed = activitiesOf(selected).filter((a) => a.time === null);
  const rows: Row[] = [
    ...blocksOf(selected).map((o) => ({
      kind: 'block' as const,
      at: minutesOf(toLocalParts(o.startAt, timeZone).time),
      o,
    })),
    ...activitiesOf(selected)
      .filter((a) => a.time !== null)
      .map((a) => ({ kind: 'activity' as const, at: minutesOf(a.time!), a })),
  ].sort((x, y) => x.at - y.at);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Días de la semana" className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const blocks = blocksOf(day).length;
          const acts = activitiesOf(day).length;
          const count = blocks + acts;
          const counts = countsLabel(blocks, acts);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={day === selected}
              aria-current={day === today ? 'date' : undefined}
              aria-label={`${WEEKDAY_LABELS[weekdayOf(day)]} ${dayNumber(day)}${
                day === today ? ' (hoy)' : ''
              }${counts ? `, ${counts}` : ''}`}
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

      {untimed.length === 0 && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 p-4 text-slate-600">
          Nada programado este día.
        </p>
      )}

      {untimed.length > 0 && (
        <section aria-labelledby="agenda-untimed" className="flex flex-col gap-2">
          <h3 id="agenda-untimed" className="text-sm font-semibold text-slate-700">
            Sin hora
          </h3>
          <ul className="flex flex-col gap-2">
            {untimed.map((a) => (
              <li key={a.activity.id}>
                <ActivityRow
                  item={a}
                  subject={a.activity.subjectId ? subjects.get(a.activity.subjectId) : undefined}
                  timeZone={timeZone}
                  onOpen={onOpenActivity}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row) =>
            row.kind === 'activity' ? (
              <li key={`a-${row.a.activity.id}`}>
                <ActivityRow
                  item={row.a}
                  subject={
                    row.a.activity.subjectId ? subjects.get(row.a.activity.subjectId) : undefined
                  }
                  timeZone={timeZone}
                  onOpen={onOpenActivity}
                />
              </li>
            ) : (
              <li key={`${row.o.blockId}-${row.o.startAt}`}>
                <button
                  type="button"
                  onClick={() => onOpen(row.o)}
                  className={`flex w-full min-w-0 overflow-hidden rounded-lg border bg-white text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                    row.o.hasConflict ? 'border-red-700' : 'border-slate-300'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: row.o.subject?.color ?? '#64748B' }}
                    className="w-2 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
                    <span className="text-lg leading-tight font-semibold">
                      {timeRange(row.o, timeZone)}
                    </span>
                    <span className="font-medium break-words">{row.o.title}</span>
                    <span className="text-sm text-slate-700 break-words">
                      {SCHEDULE_BLOCK_TYPE_LABELS[row.o.type]}
                      {row.o.subject && ` · ${row.o.subject.name}`}
                      {row.o.isRecurring && ' · se repite cada semana'}
                    </span>
                    {row.o.hasConflict && (
                      <span className="text-sm font-semibold text-red-800">
                        ⚠ Choque de horario con otro bloque
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** An open activity as a row of the day: dashed and tinted (something to do), the hour in the same place as a block's. */
function ActivityRow({
  item,
  subject,
  timeZone,
  onOpen,
}: {
  item: AgendaActivity;
  subject: Subject | undefined;
  timeZone: string;
  onOpen: (activity: Activity) => void;
}) {
  const { activity } = item;
  return (
    <button
      type="button"
      onClick={() => onOpen(activity)}
      aria-label={agendaActivityLabel(item, WEEKDAY_LABELS[weekdayOf(item.date)], timeZone)}
      className={`flex w-full min-w-0 overflow-hidden rounded-lg border border-dashed text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
        item.overdue
          ? 'border-danger-line bg-danger-soft/60 hover:bg-danger-soft'
          : 'border-accent/50 bg-accent-soft/40 hover:bg-accent-soft/70'
      }`}
    >
      <span
        aria-hidden="true"
        style={{ backgroundColor: subject?.color ?? '#64748B' }}
        className="w-2 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
        {/* No hour: the "Sin hora" heading above already says it, so the title leads. */}
        {item.time && (
          <span className="text-lg leading-tight font-semibold">
            {formatClock(activity.dueAt, timeZone)}
          </span>
        )}
        <span
          className={
            item.time
              ? 'font-medium break-words'
              : 'text-lg leading-tight font-semibold break-words'
          }
        >
          {activity.title}
        </span>
        <span className="text-sm text-slate-700 break-words">
          Actividad · {ACTIVITY_TYPE_LABELS[activity.type]}
          {subject && ` · ${subject.name}`} · {ACTIVITY_STATUS_LABELS[activity.status]}
        </span>
        {item.overdue && <span className="text-sm font-semibold text-danger-ink">Vencida</span>}
      </span>
    </button>
  );
}
