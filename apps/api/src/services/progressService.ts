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
 * Registered-activity progress of the authenticated user's CURRENT period, in general and per subject.
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

      const counts = new Map<string, StatusCounts>();
      for (const row of statusRows) {
        const c = counts.get(row.subjectId) ?? empty();
        c[STATUS_KEY[row.status]] += row._count._all;
        counts.set(row.subjectId, c);
      }
      const overdue = new Map(overdueRows.map((r) => [r.subjectId, r._count._all]));

      return {
        generatedAt,
        period: toPeriodDto(period),
        ...buildProgress(
          subjects.map((s) => ({
            ...s,
            counts: counts.get(s.id) ?? empty(),
            overdue: overdue.get(s.id) ?? 0,
          })),
        ),
      };
    },
  };
}

export type ProgressService = ReturnType<typeof createProgressService>;
