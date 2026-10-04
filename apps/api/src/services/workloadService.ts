import {
  buildWeeklyWorkload,
  localDayBounds,
  toLocalParts,
  weekRangeOf,
  type Workload,
  type WorkloadQuery,
} from '@planner/core';
import { toPeriodDto } from '../mappers.js';
import type { InsightsRepository } from '../repositories/insightsRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { ScheduleRepository } from '../repositories/scheduleRepository.js';
import type { Actor } from './activityService.js';
import { occurrencesInRange, windowOf } from './scheduleOccurrences.js';

/**
 * Commitments of ONE week (Monday to Sunday of the user's local calendar) of the CURRENT period: the activities
 * due that week and the agenda occurrences of that week, expanded with the same recurrence code the Agenda uses
 * (a weekly series is never counted as a whole). 3 queries (current period, activities of the week, agenda
 * candidates), whatever the data. A week with nothing in the period simply comes back with zeros: older periods
 * are never pulled in. `clock` is injected so "the current week" is testable.
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
      const period = await periods.findCurrent(actor.id);

      const base = { generatedAt: now.toISOString(), period: period ? toPeriodDto(period) : null };
      if (!period) {
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
          period.id,
          localDayBounds(week.from, tz).start,
          localDayBounds(week.to, tz).end,
        ),
        schedule.candidates(actor.id, { ...windowOf(week, tz), periodId: period.id }),
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
