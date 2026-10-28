import type { DateOnly } from '@planner/core';

export const MONTH_NAMES = [
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
] as const;

/** The first day of the month a date belongs to ("2026-10-28" → "2026-10-01"). Pure text: no zones involved. */
export const firstOfMonth = (d: DateOnly): DateOnly => `${d.slice(0, 7)}-01`;

/** The first day of the month `n` months after (or before, if negative) the month of `view`. */
export function shiftMonth(view: DateOnly, n: number): DateOnly {
  const index = Number(view.slice(0, 4)) * 12 + (Number(view.slice(5, 7)) - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/**
 * The days of a month laid out in weeks that start on Monday (the app's week): `null` for the squares of the neighbouring
 * months. `view` is the first day of the month. Calendar arithmetic only (the length of a month), never an instant.
 */
export function monthGrid(view: DateOnly): (DateOnly | null)[][] {
  const year = Number(view.slice(0, 4));
  const month = Number(view.slice(5, 7));
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // 0 = Monday … 6 = Sunday
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (DateOnly | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from(
      { length },
      (_, i) => `${view.slice(0, 7)}-${String(i + 1).padStart(2, '0')}` as DateOnly,
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}
