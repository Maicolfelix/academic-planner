import type { DateOnly } from './academic.js';

/**
 * Calendar arithmetic on plain dates ("YYYY-MM-DD"). No timezone is involved: a calendar day is a
 * calendar day. Everything that needs an instant goes through time.ts instead.
 */

const DAY_MS = 86_400_000;
const toMs = (d: DateOnly) => Date.parse(`${d}T00:00:00Z`);

export const addDays = (d: DateOnly, days: number): DateOnly =>
  new Date(toMs(d) + days * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export const daysBetween = (a: DateOnly, b: DateOnly): number =>
  Math.round((toMs(b) - toMs(a)) / DAY_MS);

export const maxDate = (a: DateOnly, b: DateOnly): DateOnly => (a >= b ? a : b);
export const minDate = (a: DateOnly, b: DateOnly): DateOnly => (a <= b ? a : b);

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function weekdayOf(d: DateOnly): Weekday {
  const js = new Date(toMs(d)).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as Weekday;
}

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};

/**
 * The one definition of "a week": Monday to Sunday (Colombian universities). The Agenda, the weekly
 * query and any future weekly metric use this, never their own idea of where a week starts.
 */
export function weekRangeOf(d: DateOnly): { from: DateOnly; to: DateOnly } {
  const from = addDays(d, -(weekdayOf(d) - 1));
  return { from, to: addDays(from, 6) };
}

/** The first date on or after `d` that falls on `weekday` (d itself when it already does). */
export function firstWeekdayOnOrAfter(d: DateOnly, weekday: Weekday): DateOnly {
  return addDays(d, (weekday - weekdayOf(d) + 7) % 7);
}
