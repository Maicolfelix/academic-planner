import { toLocalParts, type ScheduleOccurrence } from '@planner/core';

/** "08:00–10:00" on the user's wall clock (core does the timezone work; nothing is computed here). */
export function timeRange(
  o: Pick<ScheduleOccurrence, 'startAt' | 'endAt'>,
  timeZone: string,
): string {
  return `${toLocalParts(o.startAt, timeZone).time}–${toLocalParts(o.endAt, timeZone).time}`;
}

export const dayNumber = (date: string): string => String(Number(date.slice(8, 10)));
