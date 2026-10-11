import {
  ACTIVITY_TYPE_LABELS,
  SCHEDULE_BLOCK_TYPE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  formatClock,
  formatHourLabel,
  toLocalParts,
  weekdayOf,
  type Activity,
  type ScheduleOccurrence,
  type Subject,
} from '@planner/core';
import { agendaActivityLabel, type AgendaActivity } from './agendaActivities';
import { dayNumber, timeRange } from './format';
import { layoutDay, minutesOf } from './layoutDay';

const HOUR_PX = 48;
/** An activity is a deadline, not a stretch of time: it is drawn as a marker of this many minutes (room for two lines). */
const ACTIVITY_MINUTES = 60;

interface Props {
  days: string[];
  occurrences: ScheduleOccurrence[];
  activities: AgendaActivity[];
  subjects: ReadonlyMap<string, Subject>;
  timeZone: string;
  today: string;
  onOpen: (occurrence: ScheduleOccurrence) => void;
  onOpenActivity: (activity: Activity) => void;
}

type Item =
  | { kind: 'block'; o: ScheduleOccurrence; startMin: number; endMin: number }
  | { kind: 'activity'; a: AgendaActivity; startMin: number; endMin: number };

/**
 * Desktop view: Monday to Sunday side by side. Class blocks are positioned by their hour; the open activities with an
 * hour sit at that hour as small dashed markers (a deadline, not a duration), and the ones with no hour wait in a "Sin
 * hora" row above the grid. Blocks and activities that share a time share the width.
 */
export function WeekGrid({
  days,
  occurrences,
  activities,
  subjects,
  timeZone,
  today,
  onOpen,
  onOpenActivity,
}: Props) {
  const items: Item[] = [
    ...occurrences.map((o) => ({
      kind: 'block' as const,
      o,
      startMin: minutesOf(toLocalParts(o.startAt, timeZone).time),
      endMin: minutesOf(toLocalParts(o.endAt, timeZone).time),
    })),
    ...activities
      .filter((a) => a.time !== null)
      .map((a) => {
        const startMin = minutesOf(a.time!);
        return {
          kind: 'activity' as const,
          a,
          startMin,
          endMin: Math.min(startMin + ACTIVITY_MINUTES, 24 * 60),
        };
      }),
  ];
  const untimed = activities.filter((a) => a.time === null);

  // Show at least 07:00–20:00, and widen it only when something falls outside.
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

      {untimed.length > 0 && (
        <>
          <div className="flex items-start justify-end px-1 pt-1.5 text-right text-xs text-slate-600">
            Sin hora
          </div>
          {days.map((day) => (
            <ul
              key={day}
              aria-label={`Sin hora, ${WEEKDAY_LABELS[weekdayOf(day)]} ${dayNumber(day)}`}
              className="flex min-w-0 flex-col gap-1 border-b border-l border-slate-300 p-1"
            >
              {untimed
                .filter((a) => a.date === day)
                .map((item) => (
                  <li key={item.activity.id} className="min-w-0">
                    <ActivityMarker
                      item={item}
                      subject={
                        item.activity.subjectId ? subjects.get(item.activity.subjectId) : undefined
                      }
                      timeZone={timeZone}
                      compact
                      onOpen={onOpenActivity}
                    />
                  </li>
                ))}
            </ul>
          ))}
        </>
      )}

      <div className="relative" style={{ height }} aria-hidden="true">
        {hours.map((h) => (
          <span
            key={h}
            style={{ top: (h - firstHour) * HOUR_PX }}
            className="absolute right-1 -translate-y-2 text-xs text-slate-600"
          >
            {h > firstHour && formatHourLabel(h)}
          </span>
        ))}
      </div>

      {days.map((day) => {
        const placed = layoutDay(
          items.filter((i) => (i.kind === 'block' ? i.o.occurrenceDate : i.a.date) === day),
        );
        return (
          <div
            key={day}
            className="relative border-l border-slate-300"
            style={{
              height,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, #e2e8f0 ${HOUR_PX - 1}px, #e2e8f0 ${HOUR_PX}px)`,
            }}
          >
            {placed.map((p) => {
              const box = {
                top: ((p.startMin - firstHour * 60) / 60) * HOUR_PX,
                height: Math.max(((p.endMin - p.startMin) / 60) * HOUR_PX - 2, 22),
                left: `calc(${(p.lane * 100) / p.lanes}% + 1px)`,
                width: `calc(${100 / p.lanes}% - 2px)`,
              };
              if (p.kind === 'activity') {
                return (
                  <div key={`a-${p.a.activity.id}`} className="absolute" style={box}>
                    <ActivityMarker
                      item={p.a}
                      subject={
                        p.a.activity.subjectId ? subjects.get(p.a.activity.subjectId) : undefined
                      }
                      timeZone={timeZone}
                      compact={p.lanes > 1}
                      onOpen={onOpenActivity}
                    />
                  </div>
                );
              }
              const o = p.o;
              return (
                <button
                  key={`${o.blockId}-${o.startAt}`}
                  type="button"
                  onClick={() => onOpen(o)}
                  title={`${o.title}, ${timeRange(o, timeZone)}`}
                  aria-label={`${o.title}, ${WEEKDAY_LABELS[weekdayOf(o.occurrenceDate)]}, ${timeRange(o, timeZone).replace('–', ' a ')}${
                    o.hasConflict ? ', con choque de horario' : ''
                  }`}
                  style={{ ...box, borderLeftColor: o.subject?.color ?? '#64748B' }}
                  className={`absolute flex flex-col overflow-hidden rounded border border-l-4 bg-white p-1 text-left text-xs shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 ${
                    o.hasConflict ? 'border-red-700' : 'border-slate-300'
                  }`}
                >
                  {/* Side by side (lanes > 1) a block is ~70 px wide: keep only what fits; the full text is in its accessible name. */}
                  <span className="truncate font-semibold">
                    {o.hasConflict && p.lanes > 1 && '⚠ '}
                    {o.title}
                  </span>
                  <span className={`truncate `}>{timeRange(o, timeZone)}</span>
                  {p.lanes === 1 && (
                    <span className="truncate text-slate-700">
                      {SCHEDULE_BLOCK_TYPE_LABELS[o.type]}
                      {o.isRecurring && ' · semanal'}
                    </span>
                  )}
                  {o.hasConflict && p.lanes === 1 && (
                    <span className="truncate font-semibold text-red-800">⚠ Choque</span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * An open activity on the Agenda: dashed and tinted, so it reads as "something to do" next to the solid white class
 * blocks, and a word ("Vencida") when its deadline passed. A real button: it opens the same form as on the Activities page.
 */
export function ActivityMarker({
  item,
  subject,
  timeZone,
  compact,
  onOpen,
}: {
  item: AgendaActivity;
  subject: Subject | undefined;
  timeZone: string;
  compact: boolean;
  onOpen: (activity: Activity) => void;
}) {
  const { activity } = item;
  return (
    <button
      type="button"
      onClick={() => onOpen(activity)}
      title={`${activity.title} (${ACTIVITY_TYPE_LABELS[activity.type]})`}
      aria-label={agendaActivityLabel(item, WEEKDAY_LABELS[weekdayOf(item.date)], timeZone)}
      style={{ borderLeftColor: subject?.color ?? '#64748B' }}
      className={`flex h-full w-full min-w-0 flex-col overflow-hidden rounded border border-l-4 border-dashed px-1 py-0.5 text-left text-xs hover:bg-accent-soft/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 ${
        item.overdue
          ? 'border-danger-line bg-danger-soft text-danger-ink'
          : 'border-accent/50 bg-accent-soft/50 text-accent-ink'
      }`}
    >
      <span className="truncate font-semibold">{activity.title}</span>
      {!compact && (
        <span className="truncate">
          {item.time ? `${formatClock(activity.dueAt, timeZone)} · ` : ''}
          {ACTIVITY_TYPE_LABELS[activity.type]}
          {item.overdue && ' · Vencida'}
        </span>
      )}
      {compact && item.overdue && <span className="truncate font-semibold">Vencida</span>}
    </button>
  );
}
