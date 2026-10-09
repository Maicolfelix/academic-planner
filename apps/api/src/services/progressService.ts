import { buildProgress, type Progress, type StatusCounts } from '@planner/core';
import { toPeriodDto } from '../mappers.js';
import type { InsightsRepository } from '../repositories/insightsRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { Actor } from './activityService.js';

const empty = (): StatusCounts => ({ pending: 0, inProgress: 0, completed: 0 });
const STATUS_KEY = {
  PENDING: 'pending',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
} as const;

/**
 * Registered-activity progress of the authenticated user's CURRENT period, in general (every activity, with or without a
 * subject) and per subject (only the ones that have one).
 * 4 queries (current period, then subjects + counts by status + overdue counts in parallel), whatever the data.
 * The arithmetic is core's `buildProgress`; nothing is stored.
 */
export function createProgressService(
  insights: InsightsRepository,
  periods: PeriodRepository,
  clock: () => Date,
) {
  return {
    async get(actor: Actor): Promise<Progress> {
      const now = clock();
      const generatedAt = now.toISOString();
      const period = await periods.findCurrent(actor.id);
      if (!period) {
        return { generatedAt, period: null, ...buildProgress([]) };
      }

      const [subjects, statusRows, overdueRows] = await Promise.all([
        insights.subjects(actor.id, period.id),
        insights.statusCounts(actor.id, period.id),
        insights.overdueCounts(actor.id, period.id, now),
      ]);

      // The general activities (no subject) have no row of their own: they only weigh in the general progress.
      const counts = new Map<string, StatusCounts>();
      const general = { counts: empty(), overdue: 0 };
      for (const row of statusRows) {
        if (row.subjectId === null) {
          general.counts[STATUS_KEY[row.status]] += row._count._all;
          continue;
        }
        const c = counts.get(row.subjectId) ?? empty();
        c[STATUS_KEY[row.status]] += row._count._all;
        counts.set(row.subjectId, c);
      }
      const overdue = new Map<string, number>();
      for (const row of overdueRows) {
        if (row.subjectId === null) general.overdue += row._count._all;
        else overdue.set(row.subjectId, row._count._all);
      }

      return {
        generatedAt,
        period: toPeriodDto(period),
        ...buildProgress(
          subjects.map((s) => ({
            ...s,
            counts: counts.get(s.id) ?? empty(),
            overdue: overdue.get(s.id) ?? 0,
          })),
          general,
        ),
      };
    },
  };
}

export type ProgressService = ReturnType<typeof createProgressService>;
