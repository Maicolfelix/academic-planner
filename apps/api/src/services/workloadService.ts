import {
  buildWeeklyWorkload,
  localDayBounds,
  toLocalParts,
  weekRangeOf,
  type Workload,
  type WorkloadQuery,
} from '@planner/core';
import type { InsightsRepository } from '../repositories/insightsRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { ScheduleRepository } from '../repositories/scheduleRepository.js';
import type { Actor } from './activityService.js';
import { readCurrentPeriods } from './currentPeriods.js';
import { occurrencesInRange, windowOf } from './scheduleOccurrences.js';

/**
 * Commitments of ONE week (Monday to Sunday of the user's local calendar) of ALL the current, active periods added
 * together: the activities
 * due that week and the agenda occurrences of that week, expanded with the same recurrence code the Agenda uses
 * (a weekly series is never counted as a whole). 3 queries (current periods, activities of the week, agenda
 * candidates, each with `periodId IN (...)`), whatever the data. A week with nothing in them simply comes back with zeros: older
 * periods and archived studies are never pulled in. `clock` is injected so "the current week" is testable.
 */
export function createWorkloadService(
  insights: InsightsRepository,
  schedule: ScheduleRepository,
  periods: PeriodRepository,
  clock: () => Date,
) {
  return {
    async get(actor: Actor, query: WorkloadQuery): Promise<Workload> {
      const now = clock();
      const tz = actor.timezone;
      // Any date of the wanted week; without it, the user's LOCAL current week (never the UTC one).
      const week = weekRangeOf(query.week ?? toLocalParts(now, tz).date);
      const current = await readCurrentPeriods(periods, actor.id);

      const base = {
        generatedAt: now.toISOString(),
        period: current.home,
        periods: current.contexts,
      };
      if (current.ids.length === 0) {
        return {
          ...base,
          ...buildWeeklyWorkload({
            weekFrom: week.from,
            activities: [],
            occurrences: [],
            timeZone: tz,
          }),
        };
      }

      const [activities, blocks] = await Promise.all([
        insights.activitiesDueBetween(
          actor.id,
          current.ids,
          localDayBounds(week.from, tz).start,
          localDayBounds(week.to, tz).end,
        ),
        schedule.candidates(actor.id, { ...windowOf(week, tz), periodIds: current.ids }),
      ]);

      return {
        ...base,
        ...buildWeeklyWorkload({
          weekFrom: week.from,
          activities,
          occurrences: occurrencesInRange(blocks, week, tz),
          timeZone: tz,
        }),
      };
    },
  };
}

export type WorkloadService = ReturnType<typeof createWorkloadService>;
