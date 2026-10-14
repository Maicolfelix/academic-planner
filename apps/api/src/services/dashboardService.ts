import {
  calculateProgress,
  DASHBOARD_CLASSES_LIMIT,
  DASHBOARD_OVERDUE_LIMIT,
  DASHBOARD_UPCOMING_LIMIT,
  greetingForTime,
  localDayBounds,
  toLocalParts,
  type Dashboard,
} from '@planner/core';
import { toDashboardActivityDto } from '../mappers.js';
import type { DashboardRepository } from '../repositories/dashboardRepository.js';
import type { PeriodLookup } from '../repositories/periodRepository.js';
import type { ScheduleRepository } from '../repositories/scheduleRepository.js';
import type { Actor } from './activityService.js';
import { readCurrentPeriods } from './currentPeriods.js';
import { occurrencesInRange, windowOf } from './scheduleOccurrences.js';

/**
 * Builds the Dashboard of the authenticated user over ALL their current, active periods (the general one and the one of each
 * active study; never past periods nor an archived study's). The HOME period is kept in `period` for the screens that work
 * with one period; the numbers and lists are not limited to it.
 *
 * Main queries: 1 (the current periods, with their study) + 7 run in parallel (subject count, count by status, overdue count,
 * the overdue / today / upcoming lists and today's class candidates, each with `periodId IN (...)`) = 8, whatever the amount of
 * data or of periods. Nothing is stored: everything is derived on each request. `clock` is injected so "now", "today" and the
 * greeting are testable.
 */
export function createDashboardService(
  dashboard: DashboardRepository,
  schedule: ScheduleRepository,
  periods: Pick<PeriodLookup, 'listCurrent'>,
  clock: () => Date,
) {
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

      const current = await readCurrentPeriods(periods, actor.id);
      if (current.ids.length === 0) {
        return {
          ...base,
          period: null,
          periods: [],
          subjectCount: 0,
          summary: { total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 },
          progress: { completed: 0, total: 0, percent: 0 },
          nextDue: null,
          today: [],
          upcoming: [],
          overdue: [],
          classesToday: [],
        };
      }

      // "Today" is the user's local day (their profile timezone), never the UTC day or the browser's.
      // Already-expired deadlines of today belong to `overdue`, so the three lists never overlap.
      const endOfToday = localDayBounds(localDate, tz).end;

      const [subjectCount, counts, overdueCount, overdueRows, todayRows, upcomingRows, classRows] =
        await Promise.all([
          dashboard.countSubjects(actor.id, current.ids),
          dashboard.countByStatus(actor.id, current.ids),
          dashboard.countOverdue(actor.id, current.ids, now),
          dashboard.listOverdue(actor.id, current.ids, now, DASHBOARD_OVERDUE_LIMIT),
          dashboard.listDueBetween(actor.id, current.ids, now, endOfToday),
          dashboard.listDueAfter(actor.id, current.ids, endOfToday, DASHBOARD_UPCOMING_LIMIT),
          // Candidates only: the weekly rules are expanded in memory for today alone.
          schedule.candidates(actor.id, {
            ...windowOf({ from: localDate, to: localDate }, tz),
            types: ['CLASS'],
            periodIds: current.ids,
          }),
        ]);

      const total = counts.PENDING + counts.IN_PROGRESS + counts.COMPLETED;
      const today = todayRows.map(toDashboardActivityDto);
      const upcoming = upcomingRows.map(toDashboardActivityDto);

      return {
        ...base,
        period: current.home,
        periods: current.contexts,
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
        classesToday: occurrencesInRange(classRows, { from: localDate, to: localDate }, tz).slice(
          0,
          DASHBOARD_CLASSES_LIMIT,
        ),
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
