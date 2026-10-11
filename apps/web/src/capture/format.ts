import { WEEKDAY_LABELS, weekdayOf } from '@planner/core';

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "2026-10-06" -> "Martes 6 de octubre". Built from the string: no timezone can shift the day. */
export function humanDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${WEEKDAY_LABELS[weekdayOf(date)]} ${d} de ${MONTHS[m - 1]}`;
}

/** "2026-10-06" -> "mar 6 oct": for tight places (a list of the days a question is about). */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${WEEKDAY_LABELS[weekdayOf(date)].slice(0, 3).toLowerCase()} ${d} ${MONTHS[m - 1]!.slice(0, 3)}`;
}

/** "07:30" -> "7:30 a. m.", "17:40" -> "5:40 p. m.": the 12-hour style used across the product. */
export function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return time;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
