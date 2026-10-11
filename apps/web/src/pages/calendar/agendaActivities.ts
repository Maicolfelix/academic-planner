import { ACTIVITY_TYPE_LABELS, formatClock, toLocalParts, type Activity } from '@planner/core';

/**
 * An Activity as the Agenda draws it: the same record the Activities page and the Home read, projected onto the day and the
 * hour it is due. Nothing is copied or stored: the Agenda never has its own copy of an activity.
 */
export interface AgendaActivity {
  activity: Activity;
  /** The local day (the user's timezone), YYYY-MM-DD. */
  date: string;
  /** 'HH:mm' on the user's clock, or null for an activity with no hour ("Sin hora"). */
  time: string | null;
  /** Still open and its deadline has passed. It stays on the day it was due: it is not moved to today. */
  overdue: boolean;
}

/**
 * The open activities of the visible week, in the order they are read: by day, the ones with no hour first, then by hour.
 * A finished activity is left out (the Agenda is for what is still ahead or still owed); the rest of the app keeps showing it.
 */
export function agendaActivities(
  activities: readonly Activity[],
  timeZone: string,
  now: Date,
): AgendaActivity[] {
  return activities
    .filter((a) => a.status !== 'COMPLETED')
    .map((activity) => {
      const local = toLocalParts(activity.dueAt, timeZone);
      return {
        activity,
        date: local.date,
        time: activity.hasTime ? local.time : null,
        overdue: new Date(activity.dueAt).getTime() < now.getTime(),
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? '').localeCompare(b.time ?? '') ||
        a.activity.title.localeCompare(b.activity.title, 'es'),
    );
}

/** What a screen reader hears for an activity of the Agenda. */
export function agendaActivityLabel(
  item: AgendaActivity,
  weekday: string,
  timeZone: string,
): string {
  const { activity } = item;
  const when = item.time ? formatClock(activity.dueAt, timeZone) : 'sin hora';
  return [
    activity.title,
    `actividad (${ACTIVITY_TYPE_LABELS[activity.type].toLowerCase()})`,
    weekday,
    when,
    item.overdue ? 'vencida' : null,
  ]
    .filter(Boolean)
    .join(', ');
}
