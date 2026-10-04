import type { Db } from '../db/prisma.js';

/**
 * One read-only query for the Radar: the user's OPEN activities of one period, with their subject joined.
 * The Radar classifies them in memory with the core rule, so a single round trip serves all five groups
 * (never one query per category or per activity).
 */
export function createRadarRepository(prisma: Db) {
  return {
    listOpen: (userId: string, periodId: string) =>
      prisma.activity.findMany({
        where: { userId, subject: { periodId }, status: { not: 'COMPLETED' } },
        include: { subject: { select: { id: true, name: true, color: true } } },
        relationLoadStrategy: 'join',
        // Soonest deadline first (for OVERDUE: the most overdue first, like the Dashboard).
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      }),
  };
}

export type RadarRepository = ReturnType<typeof createRadarRepository>;
