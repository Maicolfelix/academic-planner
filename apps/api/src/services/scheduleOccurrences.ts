import {
  expandBlock,
  localDayBounds,
  markOverlaps,
  type DateOnly,
  type ScheduleOccurrence,
} from '@planner/core';
import { toBlockLike, toOccurrenceDto, type ScheduleBlockRow } from '../mappers.js';

/** The window the repository must cover to find every block that could appear in [from, to] (local days). */
export const windowOf = (range: { from: DateOnly; to: DateOnly }, timeZone: string) => ({
  rangeStart: localDayBounds(range.from, timeZone).start,
  rangeEnd: localDayBounds(range.to, timeZone).end,
  fromDay: range.from,
});

/**
 * Stored blocks -> the occurrences inside the local-day range, by start time, each flagged when it
 * overlaps another occurrence of the same result. Shared by the weekly agenda and the Dashboard so
 * both read the schedule the same way. Only the requested range is ever expanded.
 */
export function occurrencesInRange(
  rows: ScheduleBlockRow[],
  range: { from: DateOnly; to: DateOnly },
  timeZone: string,
): ScheduleOccurrence[] {
  const expanded = rows
    .flatMap((row) => expandBlock(toBlockLike(row), range, timeZone).map((o) => ({ row, o })))
    .sort(
      (a, b) =>
        a.o.startAt.getTime() - b.o.startAt.getTime() ||
        a.o.endAt.getTime() - b.o.endAt.getTime() ||
        a.row.title.localeCompare(b.row.title),
    );
  const overlapping = markOverlaps(expanded.map(({ o }) => o));
  return expanded.map(({ row, o }, i) => toOccurrenceDto(row, o, overlapping[i]!));
}
