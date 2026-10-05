import { formatClockRange, type ScheduleOccurrence } from '@planner/core';

/** "8:00–10:00 a. m." on the user's wall clock, in the 12-hour style used across the product (core does the work). */
export function timeRange(
  o: Pick<ScheduleOccurrence, 'startAt' | 'endAt'>,
  timeZone: string,
): string {
  return formatClockRange(o.startAt, o.endAt, timeZone);
}

export const dayNumber = (date: string): string => String(Number(date.slice(8, 10)));
