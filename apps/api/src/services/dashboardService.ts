import {
  calculateProgress,
  DASHBOARD_OVERDUE_LIMIT,
  DASHBOARD_UPCOMING_LIMIT,
  greetingForTime,
  localDayBounds,
  toLocalParts,
  type Dashboard,
} from '@planner/core';
import { toDashboardActivityDto, toPeriodDto } from '../mappers.js';
import type { DashboardRepository } from '../repositories/dashboardRepository.js';
import type { Actor } from './activityService.js';

/**
 * Builds the Dashboard of the authenticated user for their current period.
 *
 * Main queries: 1 (current period) + 6 run in parallel (subject count, count by status, overdue count,
 * and the overdue / today / upcoming lists) = 7, whatever the amount of data. Nothing is stored:
 * everything is derived on each request. `clock` is injected so "now", "today" and the greeting are testable.
 */
export function createDashboardService(dashboard: DashboardRepository, clock: () => Date) {
  return {
    async get(actor: Actor): Promise<Dashboard> {
      const now = clock();
      const tz = actor.timezone;
      const localDate = toLocalParts(now, tz).date;

      const base = {
        generatedAt: now.toISOString(),
        localDate,
        greeting: greetingForTime(now, tz),
      };

      const period = await dashboard.currentPeriod(actor.id);
      if (!period) {
        return {
          ...base,
          period: null,
          subjectCount: 0,
          summary: { total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 },
          progress: { completed: 0, total: 0, percent: 0 },
          nextDue: null,
          today: [],
          upcoming: [],
          overdue: [],
        };
      }

      // "Today" is the user's local day (their profile timezone), never the UTC day or the browser's.
      // Already-expired deadlines of today belong to `overdue`, so the three lists never overlap.
      const endOfToday = localDayBounds(localDate, tz).end;

      const [subjectCount, counts, overdueCount, overdueRows, todayRows, upcomingRows] =
        await Promise.all([
          dashboard.countSubjects(actor.id, period.id),
          dashboard.countByStatus(actor.id, period.id),
          dashboard.countOverdue(actor.id, period.id, now),
          dashboard.listOverdue(actor.id, period.id, now, DASHBOARD_OVERDUE_LIMIT),
          dashboard.listDueBetween(actor.id, period.id, now, endOfToday),
          dashboard.listDueAfter(actor.id, period.id, endOfToday, DASHBOARD_UPCOMING_LIMIT),
        ]);

      const total = counts.PENDING + counts.IN_PROGRESS + counts.COMPLETED;
      const today = todayRows.map(toDashboardActivityDto);
      const upcoming = upcomingRows.map(toDashboardActivityDto);

      return {
        ...base,
        period: toPeriodDto(period),
        subjectCount,
        summary: {
          total,
          pending: counts.PENDING,
          inProgress: counts.IN_PROGRESS,
          completed: counts.COMPLETED,
          overdue: overdueCount,
        },
        progress: {
          completed: counts.COMPLETED,
          total,
          percent: calculateProgress(counts.COMPLETED, total),
        },
        // Date only: the first open, not-yet-due activity. No scoring (that is a later phase).
        nextDue: today[0] ?? upcoming[0] ?? null,
        today,
        upcoming,
        overdue: overdueRows.map(toDashboardActivityDto),
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
