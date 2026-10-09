import type { Db } from '../db/prisma.js';

// Always the same scope: this user's activities of the given period (stored on the activity: no join with the subject).
const inPeriod = (userId: string, periodId: string) => ({ userId, periodId });

/**
 * Read-only queries behind Progress and Weekly workload. Each is one round trip and none depends on how many
 * subjects or activities exist (grouped counts and one range query, never a query per subject).
 */
export function createInsightsRepository(prisma: Db) {
  return {
    subjects: (userId: string, periodId: string) =>
      prisma.subject.findMany({
        where: { userId, periodId },
        select: { id: true, name: true, color: true },
      }),

    /** One GROUP BY (subject, status) instead of one COUNT per subject and status. `subjectId: null` is the general activities. */
    statusCounts: (userId: string, periodId: string) =>
      prisma.activity.groupBy({
        by: ['subjectId', 'status'],
        where: inPeriod(userId, periodId),
        _count: { _all: true },
      }),

    /** Open and past its deadline (strict `<`, the rule of `isOverdue`), counted per subject in one GROUP BY. */
    overdueCounts: (userId: string, periodId: string, now: Date) =>
      prisma.activity.groupBy({
        by: ['subjectId'],
        where: { ...inPeriod(userId, periodId), status: { not: 'COMPLETED' }, dueAt: { lt: now } },
        _count: { _all: true },
      }),

    /** Activities whose deadline falls in [from, to] (instants already converted from local days), any status. */
    activitiesDueBetween: (userId: string, periodId: string, from: Date, to: Date) =>
      prisma.activity.findMany({
        where: { ...inPeriod(userId, periodId), dueAt: { gte: from, lte: to } },
        select: { dueAt: true, status: true },
      }),
  };
}

export type InsightsRepository = ReturnType<typeof createInsightsRepository>;
