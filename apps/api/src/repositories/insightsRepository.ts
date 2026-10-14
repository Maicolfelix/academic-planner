import type { Db } from '../db/prisma.js';

// Always the same scope: this user's activities of the given periods (stored on the activity: no join with the subject).
// The ids are the SERVER's current, active periods; a client never sends them.
const inPeriods = (userId: string, periodIds: readonly string[]) => ({
  userId,
  periodId: { in: [...periodIds] },
});

/**
 * Read-only queries behind Progress and Weekly workload over ALL the current, active periods. Each is one round trip and none
 * depends on how many subjects, activities or periods exist (grouped counts and one range query, never a query per subject).
 */
export function createInsightsRepository(prisma: Db) {
  return {
    subjects: (userId: string, periodIds: readonly string[]) =>
      prisma.subject.findMany({
        where: { userId, periodId: { in: [...periodIds] } },
        select: { id: true, periodId: true, name: true, color: true },
      }),

    /**
     * One GROUP BY (period, subject, status) instead of one COUNT per subject and status. `subjectId: null` is the general
     * activities. The period comes from the activity itself, so an activity is counted exactly once.
     */
    statusCounts: (userId: string, periodIds: readonly string[]) =>
      prisma.activity.groupBy({
        by: ['periodId', 'subjectId', 'status'],
        where: inPeriods(userId, periodIds),
        _count: { _all: true },
      }),

    /** Open and past its deadline (strict `<`, the rule of `isOverdue`), counted per period and subject in one GROUP BY. */
    overdueCounts: (userId: string, periodIds: readonly string[], now: Date) =>
      prisma.activity.groupBy({
        by: ['periodId', 'subjectId'],
        where: {
          ...inPeriods(userId, periodIds),
          status: { not: 'COMPLETED' },
          dueAt: { lt: now },
        },
        _count: { _all: true },
      }),

    /** Activities whose deadline falls in [from, to] (instants already converted from local days), any status. */
    activitiesDueBetween: (userId: string, periodIds: readonly string[], from: Date, to: Date) =>
      prisma.activity.findMany({
        where: { ...inPeriods(userId, periodIds), dueAt: { gte: from, lte: to } },
        select: { dueAt: true, status: true },
      }),
  };
}

export type InsightsRepository = ReturnType<typeof createInsightsRepository>;
