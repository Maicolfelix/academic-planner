import type { ActivityStatus } from '@planner/core';
import type { PrismaClient } from '../db/prisma.js';

// Always the same scope: this user's activities of the given period (stored on the activity: no join with the subject).
const inPeriod = (userId: string, periodId: string) => ({ userId, periodId });
const open = { status: { not: 'COMPLETED' } } as const;
// The subject is optional: a general activity comes back with `subject: null`.
const withSubject = { subject: { select: { id: true, name: true, color: true } } } as const;
// Soonest deadline first; createdAt keeps equal deadlines in a stable order.
const byDeadline = [{ dueAt: 'asc' }, { createdAt: 'asc' }] as const;

/**
 * Read-only queries for the Dashboard. Each one is a single round trip and the number of queries
 * does not depend on how many activities exist (subjects are joined, never fetched per row).
 */
export function createDashboardRepository(prisma: PrismaClient) {
  return {
    currentPeriod: (userId: string) =>
      prisma.academicPeriod.findFirst({ where: { userId, isCurrent: true } }),

    countSubjects: (userId: string, periodId: string) =>
      prisma.subject.count({ where: { userId, periodId } }),

    /** One GROUP BY instead of one COUNT per status. */
    async countByStatus(userId: string, periodId: string): Promise<Record<ActivityStatus, number>> {
      const rows = await prisma.activity.groupBy({
        by: ['status'],
        where: inPeriod(userId, periodId),
        _count: { _all: true },
      });
      const counts: Record<ActivityStatus, number> = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 };
      for (const row of rows) counts[row.status] = row._count._all;
      return counts;
    },

    /** Open and past its deadline (strict `<`, the same rule as `isOverdue`). */
    countOverdue: (userId: string, periodId: string, now: Date) =>
      prisma.activity.count({
        where: { ...inPeriod(userId, periodId), ...open, dueAt: { lt: now } },
      }),

    /** Most overdue first. */
    listOverdue: (userId: string, periodId: string, now: Date, take: number) =>
      prisma.activity.findMany({
        where: { ...inPeriod(userId, periodId), ...open, dueAt: { lt: now } },
        include: withSubject,
        relationLoadStrategy: 'join',
        orderBy: [...byDeadline],
        take,
      }),

    /** Open activities due from `from` (inclusive) to `to` (inclusive): "today" is [now, end of local day]. */
    listDueBetween: (userId: string, periodId: string, from: Date, to: Date) =>
      prisma.activity.findMany({
        where: { ...inPeriod(userId, periodId), ...open, dueAt: { gte: from, lte: to } },
        include: withSubject,
        relationLoadStrategy: 'join',
        orderBy: [...byDeadline],
      }),

    /** Open activities due strictly after `after`, soonest first. */
    listDueAfter: (userId: string, periodId: string, after: Date, take: number) =>
      prisma.activity.findMany({
        where: { ...inPeriod(userId, periodId), ...open, dueAt: { gt: after } },
        include: withSubject,
        relationLoadStrategy: 'join',
        orderBy: [...byDeadline],
        take,
      }),
  };
}

export type DashboardRepository = ReturnType<typeof createDashboardRepository>;
