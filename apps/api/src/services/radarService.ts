import { RADAR_GROUP_LIMIT, RADAR_KEYS, calculateRadarStatus, type Radar } from '@planner/core';
import { toDashboardActivityDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { RadarRepository } from '../repositories/radarRepository.js';
import type { Actor } from './activityService.js';
import { readCurrentPeriods } from './currentPeriods.js';

const zeroCounts = () => ({ overdue: 0, immediate: 0, upcoming: 0, plannable: 0, underControl: 0 });
const emptyGroups = (): Radar['groups'] => ({
  overdue: [],
  immediate: [],
  upcoming: [],
  plannable: [],
  underControl: [],
});

/**
 * Academic Radar of the authenticated user over ALL their current, active periods (every one counts the same: the primary
 * study gets no priority). 2 queries: the current periods and the open activities of all of them (one `IN`, joined with their
 * subject). Classification is `calculateRadarStatus` from core — the rule is never repeated here. Nothing is stored; `clock`
 * is injected so every boundary is testable.
 */
export function createRadarService(
  radar: RadarRepository,
  periods: PeriodRepository,
  clock: () => Date,
) {
  return {
    async get(actor: Actor): Promise<Radar> {
      const now = clock();
      const generatedAt = now.toISOString();
      const current = await readCurrentPeriods(periods, actor.id);
      if (current.ids.length === 0) {
        return {
          generatedAt,
          period: null,
          periods: [],
          summary: zeroCounts(),
          groups: emptyGroups(),
        };
      }

      const summary = zeroCounts();
      const groups = emptyGroups();
      for (const row of await radar.listOpen(actor.id, current.ids)) {
        const status = calculateRadarStatus(row, now);
        if (status === null) continue; // the query already excludes COMPLETED; defensive, never listed
        const key = RADAR_KEYS[status];
        summary[key] += 1;
        if (groups[key].length < RADAR_GROUP_LIMIT) groups[key].push(toDashboardActivityDto(row));
      }
      return { generatedAt, period: current.home, periods: current.contexts, summary, groups };
    },
  };
}

export type RadarService = ReturnType<typeof createRadarService>;
