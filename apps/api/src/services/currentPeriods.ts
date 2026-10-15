import type { CurrentPeriodContext } from '@planner/core';
import { toPeriodDto } from '../mappers.js';
import {
  homeOfCurrents,
  type CurrentPeriodRow,
  type PeriodLookup,
} from '../repositories/periodRepository.js';

export const toCurrentPeriodContext = (row: CurrentPeriodRow): CurrentPeriodContext => ({
  period: toPeriodDto(row),
  studyTrack: row.studyTrack,
});

/**
 * What every summary reads: ALL the user's current, active periods (one lookup, `PeriodLookup.listCurrent`, the only
 * definition) and the HOME period among them, for the `period` field that is kept for the screens that work with one period.
 * The ids are the ONLY way a summary scopes its queries: a client can never send, add or remove one.
 */
export async function readCurrentPeriods(
  periods: Pick<PeriodLookup, 'listCurrent'>,
  userId: string,
) {
  const rows = await periods.listCurrent(userId);
  const home = homeOfCurrents(rows);
  return {
    rows,
    ids: rows.map((r) => r.id),
    contexts: rows.map(toCurrentPeriodContext),
    home: home ? toPeriodDto(home) : null,
  };
}

export type CurrentPeriods = Awaited<ReturnType<typeof readCurrentPeriods>>;
